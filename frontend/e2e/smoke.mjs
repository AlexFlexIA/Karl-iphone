// Parcours de bout en bout sur une instance de test, dans un vrai navigateur (Playwright).
// Usage : KARL_URL=http://127.0.0.1:18000 KARL_ACCESS_TOKEN=… node e2e/smoke.mjs
// L’instance doit être une base de test vide (KARL_PREVIEW=1) : le script crée des recettes, repas et articles.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let playwright
try { playwright = require('playwright') } catch { playwright = require(execSync('npm root -g').toString().trim() + '/playwright') }
const { chromium, devices } = playwright
const url = process.env.KARL_URL ?? 'http://127.0.0.1:18000'
const token = process.env.KARL_ACCESS_TOKEN
if (!token) { console.error('Définir KARL_ACCESS_TOKEN.'); process.exit(2) }

const checks = []
const check = (label, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`) }

const browser = await chromium.launch()
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(url)
  await page.evaluate(key => fetch('/api/family/bootstrap', { method: 'POST', headers: { Authorization: 'Bearer ' + key } }), token)
  await page.reload(); await page.waitForTimeout(800)
  const tab = name => page.getByRole('button', { name, exact: true }).click()

  await tab('Courses'); await tab('Repas'); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Recette', exact: true }).click()
  await page.fill('#recipe-title', 'Crêpes test'); await page.fill('#recipe-servings', '4')
  await page.fill('#recipe-ingredients', '250 g de farine\n4 œufs\n50 cl de lait\nsel')
  await page.getByRole('button', { name: 'Enregistrer' }).click(); await page.waitForTimeout(600)
  check('recette enregistrée', await page.locator('.row-open', { hasText: 'Crêpes test' }).count() === 1)

  await page.getByRole('button', { name: /^Prévoir pour .* soir/ }).first().click()
  await page.selectOption('#meal-recipe', { label: 'Crêpes test' }); await page.fill('#meal-servings', '6')
  await page.getByRole('button', { name: 'Ajouter au menu' }).click(); await page.waitForTimeout(600)
  check('repas prévu', await page.locator('.menu-dish', { hasText: 'Crêpes test' }).count() >= 1)

  await page.getByRole('button', { name: 'Courses du menu' }).click(); await page.waitForTimeout(600)
  const preview = await page.locator('.sheet .row').allInnerTexts()
  check('quantités ajustées', preview.some(line => line.includes('375 g')) && preview.some(line => line.includes('750 ml')), preview.join(' / ').replace(/\n/g, ' '))
  await page.getByRole('button', { name: /^Ajouter \d+ articles?/ }).click(); await page.waitForTimeout(700)

  await tab('Liste'); await page.waitForTimeout(400)
  await page.fill('#item-name', 'farines'); await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); await page.waitForTimeout(600)
  check('doublon refusé', (await page.locator('.toast').innerText()).includes('déjà sur la liste'))

  await tab('Tâches'); await page.waitForTimeout(400)
  await page.fill('#task-title', 'Poubelles test'); await page.getByRole('checkbox', { name: /Chaque semaine/ }).check()
  const today = new Date(), pad = n => String(n).padStart(2, '0')
  await page.fill('#task-date', `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); await page.waitForTimeout(600)
  await page.locator('.row', { hasText: 'Poubelles test' }).locator('input[type=checkbox]').first().check(); await page.waitForTimeout(900)
  check('tâche hebdomadaire reconduite', await page.locator('.row', { hasText: 'Poubelles test' }).count() >= 2)

  await tab('Moi'); await page.waitForTimeout(400)
  await page.fill('#memory-text', 'Info de test'); await page.getByRole('button', { name: 'Retenir' }).click(); await page.waitForTimeout(500)
  check('mémoire Hermes', await page.locator('#hermes-title ~ ul .row-title', { hasText: 'Info de test' }).count() === 1)

  check('aucun débordement horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  check('aucune erreur JavaScript', !errors.length, errors.join(' | '))
} catch (error) {
  check('parcours terminé', false, error.message.split('\n')[0])
} finally {
  await browser.close()
}
process.exit(checks.every(Boolean) ? 0 : 1)
