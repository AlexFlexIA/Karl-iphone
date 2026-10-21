// KARL — démo hors ligne. Remplace le serveur par un faux en mémoire (sauvegardé dans ce navigateur) pour essayer
// l'interface sans compte. Les règles reprennent celles du serveur : portions, regroupement des produits, rayons,
// doublons, tâches hebdomadaires, rappels. Hermes répond avec des réponses préenregistrées.
(function () {
  const KEY = 'karl-demo-v1'
  const realFetch = window.fetch.bind(window)
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
  const nowIso = () => new Date().toISOString()
  const pad = n => String(n).padStart(2, '0')
  const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const addDays = (key, n) => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() + n); return dkey(d) }
  const today = () => dkey(new Date())
  const monday = () => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dkey(d) }
  const at = (key, hm) => new Date(`${key}T${hm}:00`).toISOString()

  // Same matching rules as backend/app/words.py.
  const plain = v => v.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/’/g, "'").split(/\s+/).filter(Boolean).join(' ')
  const APART = { 'pâté': 'pate_e', 'pâtés': 'pate_e' }
  const keyOf = name => name.toLowerCase().split(/[\s-]+/).filter(Boolean).map(w => APART[w] || ((p) => p.length > 3 && /[sx]$/.test(p) ? p.slice(0, -1) : p)(plain(w))).join(' ')
  const AISLES = {
    'Fruits et légumes': 'pomme poire banane citron orange fraise tomate carotte courgette oignon echalote ail salade poireau patate champignon poivron aubergine epinard brocoli chou concombre avocat persil basilic coriandre ciboulette herbe legume fruit haricot courge potiron navet radis',
    'Frais': 'lait beurre creme oeuf yaourt fromage gruyere emmental parmesan mozzarella feta comte jambon lardon poulet boeuf veau porc dinde steak viande saumon cabillaud poisson crevette',
    'Maison': 'lessive adoucissant eponge savon shampoing dentifrice brosse poubelle essuie papier mouchoir javel nettoyant pile ampoule couche lingette deodorant',
    'Épicerie': 'farine sucre sel poivre huile vinaigre riz pate spaghetti semoule lentille quinoa chocolat levure miel moutarde bouillon epice cumin curry paprika thym laurier conserve sauce concentré purée biscuit cereale café thé confiture amande noix',
  }
  const PHRASES = { 'pomme de terre': 'Fruits et légumes', 'lait de coco': 'Épicerie', 'pois chiche': 'Épicerie', 'pâte feuilletée': 'Frais', 'pâte brisée': 'Frais', 'gel douche': 'Maison', 'liquide vaisselle': 'Maison', 'papier toilette': 'Maison', 'sac poubelle': 'Maison' }
  const STOP = new Set(['de', "d'", 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'en', 'et'])
  const significant = n => keyOf(n).replace(/d'/g, '').split(' ').filter(w => w && !STOP.has(w))
  const VOCAB = Object.fromEntries(Object.entries(AISLES).map(([a, t]) => [a, new Set(t.split(' ').map(keyOf))]))
  const aisleOf = name => {
    const words = significant(name), text = ' ' + words.join(' ') + ' '
    for (const [p, a] of Object.entries(PHRASES)) if (text.includes(' ' + significant(p).join(' ') + ' ')) return a
    for (const w of words) for (const [a, set] of Object.entries(VOCAB)) if (set.has(w)) return a
    return 'Autres'
  }
  const UNITS = [[/^(kg|kilos?|kilogrammes?)(?=\s|$)\s*/i, 'kg'], [/^(g|gr|grammes?)(?=\s|$)\s*/i, 'g'], [/^(l|litres?)(?=\s|$)\s*/i, 'l'], [/^dl(?=\s|$)\s*/i, 'dl'], [/^cl(?=\s|$)\s*/i, 'cl'], [/^ml(?=\s|$)\s*/i, 'ml'],
    [/^(c\.?\s*à\s*s\.?|cs|càs|cuill[eè]res?\s+à\s+soupe)(?=\s|$)\s*/i, 'c. à s.'], [/^(c\.?\s*à\s*c\.?|cc|càc|cuill[eè]res?\s+à\s+caf[ée])(?=\s|$)\s*/i, 'c. à c.'],
    [/^pinc[ée]es?(?=\s|$)\s*/i, 'pincée'], [/^gousses?(?=\s|$)\s*/i, 'gousse'], [/^tranches?(?=\s|$)\s*/i, 'tranche'], [/^bo[iî]tes?(?=\s|$)\s*/i, 'boîte'], [/^sachets?(?=\s|$)\s*/i, 'sachet'], [/^pots?(?=\s|$)\s*/i, 'pot'], [/^paquets?(?=\s|$)\s*/i, 'paquet']]
  const BASE = { kg: ['g', 1000], g: ['g', 1], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10], ml: ['ml', 1] }
  function parseLine(line) {
    const text = line.trim().replace(/^[-•*]\s*/, '')
    if (!text) return null
    let quantity = null, unit = '', rest = text
    const m = text.match(/^(\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾])\s*(.*)$/)
    if (m) {
      const t = m[1]
      quantity = t === '½' ? 0.5 : t === '¼' ? 0.25 : t === '¾' ? 0.75 : t.includes('/') ? Number(t.split('/')[0]) / Number(t.split('/')[1]) : Number(t.replace(',', '.'))
      rest = m[2]
      for (const [re, u] of UNITS) { const f = rest.match(re); if (f) { unit = u; rest = rest.slice(f[0].length); break } }
    }
    rest = rest.replace(/^(de\s+la\s+|de\s+l['’]\s*|du\s+|des\s+|de\s+|d['’]\s*)/i, '').trim()
    if (!rest || (quantity !== null && !(quantity > 0) )) throw new Error(text)
    return { line: text.slice(0, 200), name: rest.slice(0, 120), quantity, unit, category: aisleOf(rest) }
  }
  const amount = v => String(Math.round(v * 100) / 100).replace('.', ',')
  function label(q, unit) {
    if (q == null) return ''
    if (unit === 'g' && q >= 1000) { q /= 1000; unit = 'kg' }
    if (unit === 'ml' && q >= 1000) { q /= 1000; unit = 'l' }
    if (unit && !['g', 'kg', 'ml', 'l', 'c. à s.', 'c. à c.'].includes(unit) && q > 1) unit += 's'
    return `${amount(q)} ${unit}`.trim()
  }

  function seed() {
    const me = uid(), lea = uid(), tom = uid(), mon = monday(), t = today()
    const recipe = (title, servings, lines, notes = '') => ({ id: uid(), title, servings, ingredients: lines.map(parseLine), notes, created_by: me, version: 1, deleted: 0 })
    const crepes = recipe('Crêpes', 4, ['250 g de farine', '4 œufs', '50 cl de lait', '1 pincée de sel'], 'Mélanger, laisser reposer une heure, cuire à la poêle.')
    const gratin = recipe('Gratin dauphinois', 6, ['1,5 kg de pommes de terre', '50 cl de crème', '25 cl de lait', '2 gousses d’ail', 'sel'])
    const soupe = recipe('Soupe de carottes', 4, ['1 kg de carottes', '1 oignon', '1 l de bouillon', '2 c. à s. de crème'])
    const pates = recipe('Pâtes au saumon', 4, ['400 g de pâtes', '200 g de saumon fumé', '20 cl de crème', '1 citron'])
    return {
      me,
      members: [{ id: me, name: 'Alex', role: 'admin', is_owner: true, badge: 0, active: true, assistant: true, email: 'demo@example.test' },
        { id: lea, name: 'Léa', role: 'member', is_owner: false, badge: 1, active: true, assistant: true, email: null },
        { id: tom, name: 'Tom', role: 'member', is_owner: false, badge: 2, active: true, assistant: true, email: null }],
      items: [['Pain', '', 'Autres'], ['Bananes', '6', 'Fruits et légumes'], ['Yaourts nature', '8', 'Frais'], ['Liquide vaisselle', '', 'Maison']]
        .map(([name, quantity, category]) => ({ id: uid(), name, quantity, category, checked: 0, deleted: 0, version: 1, updated_by: me, updated_at: nowIso() })),
      tasks: [
        { id: uid(), title: 'Sortir les poubelles', assignee_id: tom, due_date: addDays(t, 1), done: 0, deleted: 0, created_by: me, version: 1, key_task: 0, submitted_by: null, submitted_at: null, validated_by: null, repeat: 'weekly', next_id: null, remind_at: null },
        { id: uid(), title: 'Prendre rendez-vous chez le dentiste', assignee_id: me, due_date: addDays(t, 2), done: 0, deleted: 0, created_by: me, version: 1, key_task: 0, submitted_by: null, submitted_at: null, validated_by: null, repeat: 'none', next_id: null, remind_at: at(addDays(t, 2), '09:00') },
        { id: uid(), title: 'Ranger la chambre', assignee_id: lea, due_date: t, done: 0, deleted: 0, created_by: me, version: 1, key_task: 1, submitted_by: null, submitted_at: null, validated_by: null, repeat: 'none', next_id: null, remind_at: null },
      ],
      events: [
        { id: uid(), title: 'Piscine', starts_at: at(addDays(mon, 2), '17:00'), ends_at: at(addDays(mon, 2), '18:00'), attendees: [lea], driver_id: me, location: 'Piscine municipale', recurrence: 'weekly', created_by: me, version: 1, deleted: 0, ask: 0 },
        { id: uid(), title: 'Foot', starts_at: at(addDays(mon, 5), '10:00'), ends_at: at(addDays(mon, 5), '11:30'), attendees: [tom], driver_id: null, location: 'Stade', recurrence: 'weekly', created_by: me, version: 1, deleted: 0, ask: 0 },
        { id: uid(), title: 'Dîner chez Mamie', starts_at: at(t, '19:30'), ends_at: at(t, '22:00'), attendees: [me, lea, tom], driver_id: me, location: '', recurrence: 'once', created_by: me, version: 1, deleted: 0, ask: 0 },
      ],
      replies: {},
      recipes: [crepes, gratin, soupe, pates],
      meals: [
        { id: uid(), day: t, slot: 'dinner', recipe_id: soupe.id, title: soupe.title, servings: 3, created_by: me, version: 1, deleted: 0 },
        { id: uid(), day: addDays(t, 1), slot: 'dinner', recipe_id: crepes.id, title: crepes.title, servings: 3, created_by: me, version: 1, deleted: 0 },
        { id: uid(), day: addDays(t, 2), slot: 'lunch', recipe_id: null, title: 'Cantine', servings: 3, created_by: me, version: 1, deleted: 0 },
      ],
      threads: [], messages: [], memory: [{ id: uid(), text: 'Préfère les rappels le matin', created_at: nowIso() }],
    }
  }
  let db
  try { db = JSON.parse(localStorage.getItem(KEY)) } catch { db = null }
  if (!db || !db.me) db = seed()
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* Démo en mémoire seulement. */ } }
  save()
  window.karlDemoReset = () => { try { localStorage.removeItem(KEY) } catch { /* rien */ } location.reload() }

  class Fail extends Error { constructor(status, detail) { super(detail); this.status = status } }
  const me = () => db.members.find(m => m.id === db.me)
  const isAdmin = () => me().role === 'admin'
  const canManage = createdBy => isAdmin() || createdBy === db.me
  const waiting = (name, except) => db.items.find(i => !i.deleted && !i.checked && i.id !== except && keyOf(i.name) === keyOf(name))
  const byId = (list, id, what) => { const row = list.find(x => x.id === id); if (!row) throw new Fail(404, what + ' introuvable.'); return row }
  const bump = (row, version, what) => { if (row.version !== version) throw new Fail(409, what + ' a changé sur un autre appareil. Actualisez puis réessayez.'); row.version += 1 }

  function occurrences(first, last) {
    const start = new Date(first + 'T00:00:00'), end = new Date(addDays(last, 1) + 'T00:00:00'), out = []
    for (const e of db.events.filter(x => !x.deleted)) {
      let b = new Date(e.starts_at), f = new Date(e.ends_at)
      const step = () => { b = new Date(b.getTime() + 7 * 86400000); f = new Date(f.getTime() + 7 * 86400000) }
      if (e.recurrence === 'weekly') while (f <= start) step()
      for (let i = 0; i < (e.recurrence === 'weekly' ? 12 : 1); i++) {
        if (b >= end) break
        if (f > start) out.push({ ...e, starts_at: b.toISOString(), ends_at: f.toISOString(), series_starts_at: e.starts_at, series_ends_at: e.ends_at, replies: db.replies[e.id] || {} })
        if (e.recurrence !== 'weekly') break
        step()
      }
    }
    return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }
  const counts = m => { const r = m.recipe_id && db.recipes.find(x => x.id === m.recipe_id && !x.deleted); return !!(r && r.ingredients.length) }
  function totals(dishes) {
    const lines = {}
    for (const [title, ingredients, factor] of dishes) for (const item of ingredients) {
      const key = keyOf(item.name)
      const line = lines[key] ||= { key, name: item.name, category: item.category, amounts: {}, sources: [] }
      if (!line.sources.includes(title)) line.sources.push(title)
      if (item.quantity == null) { if (!('' in line.amounts)) line.amounts[''] = null; continue }
      const [unit, scale] = BASE[item.unit] || [item.unit, 1]
      line.amounts[unit] = (line.amounts[unit] || 0) + item.quantity * scale * factor
    }
    const recent = new Date(Date.now() - 3 * 86400000).toISOString(), listed = {}
    for (const i of [...db.items].sort((a, b) => a.checked - b.checked)) {
      if (i.deleted || (i.checked && i.updated_at < recent)) continue
      const k = keyOf(i.name); if (!(k in listed)) listed[k] = i.checked ? 'dans le panier' : i.quantity || 'sur la liste'
    }
    return Object.values(lines).sort((a, b) => (a.category + plain(a.name)).localeCompare(b.category + plain(b.name))).map(l => ({
      key: l.key, name: l.name.charAt(0).toUpperCase() + l.name.slice(1), category: l.category,
      quantity: Object.entries(l.amounts).map(([u, q]) => label(q, u)).filter(Boolean).join(' + '), sources: l.sources, on_list: listed[l.key] ?? null,
    }))
  }
  function needs(first, last) {
    let without = 0; const dishes = []
    for (const m of db.meals.filter(m => !m.deleted && m.day >= first && m.day <= last)) {
      if (!counts(m)) { without++; continue }
      const r = db.recipes.find(x => x.id === m.recipe_id)
      dishes.push([r.title, r.ingredients, m.servings / r.servings])
    }
    return [totals(dishes), without]
  }
  function addLines(lines, keys) {
    const chosen = lines.filter(l => keys.includes(l.key) && !l.on_list)
    for (const l of chosen) db.items.push({ id: uid(), name: l.name, quantity: l.quantity, category: l.category, checked: 0, deleted: 0, version: 1, updated_by: db.me, updated_at: nowIso() })
    return { added: chosen.length, skipped: lines.filter(l => keys.includes(l.key)).length - chosen.length }
  }
  const mealOut = m => ({ ...m, title: (m.recipe_id && db.recipes.find(r => r.id === m.recipe_id)?.title) || m.title, has_recipe: counts(m) })
  const ingredientsOf = lines => lines.map((line, i) => { try { return parseLine(line) } catch { throw new Fail(422, `Ingrédient ${i + 1} illisible : écrivez par exemple « 200 g de farine ».`) } }).filter(Boolean)

  function demoReply(text) {
    const t = plain(text), d1 = addDays(today(), 1), d2 = addDays(today(), 2)
    if (/menu|repas|manger|diner|recette/.test(t)) {
      const [a, b] = db.recipes.filter(r => !r.deleted)
      return { content: 'Voici deux idées tirées de votre carnet pour les soirs encore libres.', proposals: [a, b].filter(Boolean).map((r, i) => ({ kind: 'meal', title: r.title, day: addDays(today(), 3 + i), slot: 'dinner', servings: 3, ref: null, why: 'Ce soir-là n’a pas encore de repas prévu.' })) }
    }
    if (/lait|course|liste|acheter/.test(t)) return { content: 'Je peux l’ajouter à la liste partagée.', proposals: [{ kind: 'item', title: 'Lait', quantity: '2 l', category: 'Frais', ref: null, why: 'Les crêpes de demain en demandent.' }] }
    if (/rappel|rappelle|dentiste/.test(t)) return { content: 'Je te propose une tâche avec un rappel.', proposals: [{ kind: 'task', title: 'Appeler le dentiste', due_date: d2, assignee_id: db.me, repeat: 'none', remind_at: at(d2, '09:00'), ref: null }] }
    if (/semaine|point/.test(t)) return { content: 'Cette semaine : piscine mercredi pour Léa, foot samedi pour Tom, dîner chez Mamie ce soir. Une tâche clé attend d’être faite (ranger la chambre).', proposals: [] }
    return { content: 'Hermes de démonstration : demande par exemple « propose un menu », « mets du lait sur la liste » ou « rappelle-moi le dentiste ».', proposals: [] }
  }

  const routes = [
    ['GET', /^auth\/session$/, () => ({ user: (({ id, name, role, is_owner, badge }) => ({ id, name, role, is_owner, badge }))(me()), csrf: 'demo', google_enabled: false, preview: true })],
    ['POST', /^auth\/logout$/, () => { throw new Fail(403, 'Dans la démo, on reste connecté. Pour repartir de zéro : bouton « Réinitialiser la démo » en bas de l’écran.') }],
    ['GET', /^family\/members$/, () => ({ members: db.members })],
    ['PATCH', /^family\/members\/([^/]+)$/, (b, m) => { const x = byId(db.members, m[1], 'Membre'); if (b.active != null) x.active = b.active; if (b.assistant != null) x.assistant = b.assistant; return { ok: true } }],
    ['POST', /^family\/invitations$/, () => ({ url: location.href.split('#')[0] + '#invitation=demo', expires_in_days: 7 })],
    ['PATCH', /^family\/profile$/, b => { Object.assign(me(), { name: b.name, email: b.email }); return { ok: true } }],
    ['GET', /^family\/weather$/, () => ({ place: 'Démo', station_status: 'connected', forecast_status: 'connected', tomorrow: addDays(today(), 1),
      station: { timestamp: nowIso(), temperature_c: 11.4, humidity_pct: 82, wind_avg_kmh: 9, rain_today_mm: 0.6, stale: false },
      forecast: { date: today(), today: { code: 3, label: 'Nuageux', icon: 'cloud', min_c: 7, max_c: 14, rain_mm: 1.2, rain_chance: 40, wind_max_kmh: 25 },
        parts: [{ part: 'Matin', hour: 9, code: 2, label: 'Éclaircies', icon: 'partly', temperature_c: 9, rain_chance: 10 }, { part: 'Après-midi', hour: 15, code: 3, label: 'Nuageux', icon: 'cloud', temperature_c: 14, rain_chance: 30 }, { part: 'Soir', hour: 20, code: 61, label: 'Pluie', icon: 'rain', temperature_c: 10, rain_chance: 60 }] },
      tempo: { date: addDays(today(), 1), color: 'blanc' } })],
    ['GET', /^family\/items$/, () => ({ items: db.items.filter(i => !i.deleted).map(i => ({ ...i, author: db.members.find(m => m.id === i.updated_by)?.name || '?' })) })],
    ['POST', /^family\/items$/, b => {
      const dup = waiting(b.name); if (dup) return { id: dup.id, duplicate: true }
      const item = { id: uid(), name: b.name.trim(), quantity: (b.quantity || '').trim(), category: b.category || aisleOf(b.name), checked: 0, deleted: 0, version: 1, updated_by: db.me, updated_at: nowIso() }
      db.items.push(item); return { id: item.id, duplicate: false }
    }],
    ['POST', /^family\/items\/clear$/, () => { const ids = db.items.filter(i => !i.deleted && i.checked).map(i => (i.deleted = 1, i.version++, i.id)); return { ids } }],
    ['POST', /^family\/items\/restore$/, b => { for (const i of db.items) if (b.ids.includes(i.id) && i.deleted && i.checked) { i.deleted = 0; i.version++ } return { ok: true } }],
    ['PATCH', /^family\/items\/([^/]+)$/, (b, m) => {
      const i = byId(db.items, m[1], 'Article'), name = b.name != null ? b.name.trim() : i.name
      const checked = b.checked ?? i.checked, deleted = b.deleted ?? i.deleted
      if (!checked && !deleted && (i.checked || i.deleted || name !== i.name) && waiting(name, i.id)) throw new Fail(409, `« ${name} » est déjà sur la liste à prendre.`)
      bump(i, b.version, 'Cet article'); Object.assign(i, { name, checked: +checked, deleted: +deleted, quantity: b.quantity != null ? b.quantity.trim() : i.quantity, category: b.category || i.category, updated_by: db.me, updated_at: nowIso() })
      return { ok: true }
    }],
    ['GET', /^family\/tasks$/, () => ({ tasks: db.tasks.filter(t => !t.deleted).sort((a, b) => a.done - b.done || (a.due_date || '9').localeCompare(b.due_date || '9')) })],
    ['POST', /^family\/tasks$/, b => {
      if (b.repeat === 'weekly' && !b.due_date) throw new Fail(422, 'Une tâche hebdomadaire a besoin d’une date.')
      const task = { id: uid(), title: b.title.trim(), assignee_id: b.assignee_id, due_date: b.due_date, done: 0, deleted: 0, created_by: db.me, version: 1, key_task: b.key_task ? 1 : 0, submitted_by: null, submitted_at: null, validated_by: null, repeat: b.repeat || 'none', next_id: null, remind_at: b.remind_at || null }
      db.tasks.push(task); return { id: task.id }
    }],
    ['PATCH', /^family\/tasks\/([^/]+)$/, (b, m) => {
      const t = byId(db.tasks, m[1], 'Tâche'), wasDone = t.done
      bump(t, b.version, 'Cette tâche')
      if (b.deleted != null) t.deleted = +b.deleted
      for (const k of ['title', 'assignee_id', 'due_date', 'remind_at']) if (k in b) t[k] = b[k]
      if (b.review === 'approve') Object.assign(t, { done: 1, validated_by: db.me })
      else if (b.review === 'reject') Object.assign(t, { submitted_by: null, submitted_at: null })
      else if (b.done != null && t.key_task && !isAdmin()) Object.assign(t, { submitted_by: b.done ? db.me : null, submitted_at: b.done ? nowIso() : null })
      else if (b.done != null) Object.assign(t, { done: +b.done }, b.done ? {} : { submitted_by: null, submitted_at: null })
      if (t.repeat === 'weekly' && t.due_date && !!wasDone !== !!t.done) {
        if (t.done && !t.next_id) {
          const copy = { ...t, id: uid(), due_date: addDays(t.due_date, 7), done: 0, version: 1, submitted_by: null, submitted_at: null, validated_by: null, next_id: null, remind_at: t.remind_at && new Date(new Date(t.remind_at).getTime() + 7 * 86400000).toISOString() }
          db.tasks.push(copy); t.next_id = copy.id
        } else if (!t.done && t.next_id) { const n = db.tasks.find(x => x.id === t.next_id); if (n && !n.done && !n.submitted_by) { n.deleted = 1; t.next_id = null } }
      }
      return { ok: true }
    }],
    ['GET', /^family\/events\/pending$/, () => ({ events: [] })],
    ['GET', /^family\/events$/, (b, m, q) => ({ events: occurrences(q.get('first'), q.get('last')) })],
    ['POST', /^family\/events$/, b => { const e = { id: uid(), ...b, created_by: db.me, version: 1, deleted: 0, ask: b.ask ? 1 : 0 }; db.events.push(e); return { id: e.id } }],
    ['PUT', /^family\/events\/([^/]+)$/, (b, m) => { const e = byId(db.events, m[1], 'Événement'); bump(e, b.version, 'Cet événement'); const { version, ...rest } = b; Object.assign(e, rest, { ask: b.ask ? 1 : 0 }); return { ok: true } }],
    ['PATCH', /^family\/events\/([^/]+)$/, (b, m) => { const e = byId(db.events, m[1], 'Événement'); bump(e, b.version, 'Cet événement'); e.deleted = +b.deleted; return { ok: true } }],
    ['POST', /^family\/events\/([^/]+)\/reply$/, () => ({ ok: true })],
    ['GET', /^family\/recipes$/, () => ({ recipes: db.recipes.filter(r => !r.deleted).sort((a, b) => a.title.localeCompare(b.title, 'fr')) })],
    ['POST', /^family\/recipes$/, b => { const r = { id: uid(), title: b.title.trim(), servings: b.servings || 4, ingredients: ingredientsOf(b.ingredients || []), notes: (b.notes || '').trim(), created_by: db.me, version: 1, deleted: 0 }; db.recipes.push(r); return { id: r.id } }],
    ['PUT', /^family\/recipes\/([^/]+)$/, (b, m) => { const r = byId(db.recipes, m[1], 'Recette'); const ingredients = ingredientsOf(b.ingredients || []); bump(r, b.version, 'Cette recette'); Object.assign(r, { title: b.title.trim(), servings: b.servings, ingredients, notes: (b.notes || '').trim() }); return { ok: true } }],
    ['PATCH', /^family\/recipes\/([^/]+)$/, (b, m) => { const r = byId(db.recipes, m[1], 'Recette'); bump(r, b.version, 'Cette recette'); r.deleted = +b.deleted; return { ok: true } }],
    ['GET', /^family\/recipes\/([^/]+)\/shopping$/, (b, m, q) => { const r = byId(db.recipes, m[1], 'Recette'); return { lines: totals([[r.title, r.ingredients, Number(q.get('servings')) / r.servings]]) } }],
    ['POST', /^family\/recipes\/([^/]+)\/shopping$/, (b, m) => { const r = byId(db.recipes, m[1], 'Recette'); return addLines(totals([[r.title, r.ingredients, b.servings / r.servings]]), b.keys) }],
    ['GET', /^family\/meals\/shopping$/, (b, m, q) => { const [lines, without] = needs(q.get('first'), q.get('last')); return { lines, without_recipe: without } }],
    ['POST', /^family\/meals\/shopping$/, b => addLines(needs(b.first, b.last)[0], b.keys)],
    ['POST', /^family\/meals\/copy$/, b => {
      const shift = Math.round((new Date(b.target + 'T12:00:00') - new Date(b.source + 'T12:00:00')) / 86400000)
      const taken = new Set(db.meals.filter(x => !x.deleted).map(x => x.day + x.slot)); let copied = 0
      for (const x of db.meals.filter(x => !x.deleted && x.day >= b.source && x.day <= addDays(b.source, 6))) {
        const day = addDays(x.day, shift); if (taken.has(day + x.slot)) continue
        db.meals.push({ ...x, id: uid(), day, version: 1, created_by: db.me }); copied++
      }
      return { copied }
    }],
    ['GET', /^family\/meals$/, (b, m, q) => ({ meals: db.meals.filter(x => !x.deleted && x.day >= q.get('first') && x.day <= q.get('last')).map(mealOut) })],
    ['POST', /^family\/meals$/, b => {
      const r = b.recipe_id && db.recipes.find(x => x.id === b.recipe_id && !x.deleted)
      const title = r ? r.title : (b.title || '').trim(); if (!title) throw new Fail(422, 'Choisissez une recette ou écrivez le nom du repas.')
      const meal = { id: uid(), day: b.day, slot: b.slot || 'dinner', recipe_id: r ? r.id : null, title, servings: b.servings || 4, created_by: db.me, version: 1, deleted: 0 }
      db.meals.push(meal); return { id: meal.id }
    }],
    ['PUT', /^family\/meals\/([^/]+)$/, (b, m) => { const x = byId(db.meals, m[1], 'Repas'); bump(x, b.version, 'Ce repas'); Object.assign(x, { slot: b.slot, servings: b.servings }); return { ok: true } }],
    ['PATCH', /^family\/meals\/([^/]+)$/, (b, m) => { const x = byId(db.meals, m[1], 'Repas'); bump(x, b.version, 'Ce repas'); x.deleted = +b.deleted; return { ok: true } }],
    ['GET', /^family\/assistant$/, () => ({ enabled: true, configured: true, remaining: 60 - db.messages.filter(x => x.role === 'user' && x.created_at.startsWith(today())).length,
      threads: db.threads.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)) })],
    ['GET', /^family\/assistant\/memory$/, () => ({ memory: db.memory, limit: 50 })],
    ['POST', /^family\/assistant\/memory$/, b => { const x = { id: uid(), text: b.text.trim(), created_at: nowIso() }; db.memory.push(x); return { id: x.id } }],
    ['DELETE', /^family\/assistant\/memory\/([^/]+)$/, (b, m) => { db.memory = db.memory.filter(x => x.id !== m[1]); return { ok: true } }],
    ['GET', /^family\/assistant\/threads\/([^/]+)$/, (b, m) => ({ messages: db.messages.filter(x => x.thread_id === m[1]) })],
    ['PATCH', /^family\/assistant\/threads\/([^/]+)$/, (b, m) => { byId(db.threads, m[1], 'Conversation').title = b.title.trim(); return { ok: true } }],
    ['DELETE', /^family\/assistant\/threads\/([^/]+)$/, (b, m) => { db.threads = db.threads.filter(x => x.id !== m[1]); db.messages = db.messages.filter(x => x.thread_id !== m[1]); return { ok: true } }],
    ['POST', /^family\/assistant\/chat$/, async b => {
      await new Promise(r => setTimeout(r, 700))
      const stamp = nowIso(), reply = demoReply(b.message)
      const thread = db.threads.find(x => x.id === b.thread_id)
      if (thread) thread.updated_at = stamp; else db.threads.push({ id: b.thread_id, title: b.message.slice(0, 80), updated_at: stamp })
      db.messages.push({ id: db.messages.length + 1, thread_id: b.thread_id, role: 'user', content: b.message, proposals: [], created_at: stamp })
      const message = { id: db.messages.length + 1, thread_id: b.thread_id, role: 'assistant', content: reply.content, proposals: reply.proposals, created_at: stamp }
      db.messages.push(message); return { message }
    }],
    ['POST', /^family\/assistant\/messages\/(\d+)\/accept$/, (b, m) => {
      const msg = db.messages.find(x => x.id === Number(m[1])); const p = msg && msg.proposals[b.index]; if (!p) throw new Fail(404, 'Proposition introuvable.')
      if (p.ref) return { id: p.ref }
      if (p.kind === 'meal') { const r = db.recipes.find(x => !x.deleted && x.title.toLowerCase() === p.title.toLowerCase()); const meal = { id: uid(), day: p.day, slot: p.slot, recipe_id: r ? r.id : null, title: p.title, servings: p.servings, created_by: db.me, version: 1, deleted: 0 }; db.meals.push(meal); p.ref = meal.id }
      else if (p.kind === 'item') { const dup = waiting(p.title); if (dup) p.ref = dup.id; else { const item = { id: uid(), name: p.title, quantity: p.quantity, category: p.category, checked: 0, deleted: 0, version: 1, updated_by: db.me, updated_at: nowIso() }; db.items.push(item); p.ref = item.id } }
      else if (p.kind === 'task') { const task = { id: uid(), title: p.title, assignee_id: p.assignee_id, due_date: p.due_date, done: 0, deleted: 0, created_by: db.me, version: 1, key_task: 0, submitted_by: null, submitted_at: null, validated_by: null, repeat: p.repeat || 'none', next_id: null, remind_at: p.remind_at }; db.tasks.push(task); p.ref = task.id }
      return { id: p.ref }
    }],
  ]

  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href)
    const index = url.pathname.indexOf('/api/')
    if (index < 0) return realFetch(input, init)
    const path = url.pathname.slice(index + 5), method = (init.method || 'GET').toUpperCase()
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (!path.startsWith('family/') && !path.startsWith('auth/')) return json(401, { detail: 'L’espace personnel n’est pas inclus dans la démo : il a besoin du vrai serveur et de votre clé.' })
    for (const [verb, pattern, handler] of routes) {
      const match = verb === method && path.match(pattern)
      if (!match) continue
      try {
        const result = await handler(init.body ? JSON.parse(init.body) : {}, match, url.searchParams)
        if (method !== 'GET') save()
        return json(method === 'POST' && /items$|tasks$|events$|recipes$|meals$|memory$/.test(path) ? 201 : 200, result)
      } catch (error) {
        return json(error.status || 422, { detail: error.status ? error.message : 'Vérifiez les champs du formulaire.' })
      }
    }
    return json(404, { detail: 'Fonction non disponible dans la démo.' })
  }
})()
