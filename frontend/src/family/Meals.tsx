import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import type { Ctx } from './context'
import type { Meal, Recipe, ShoppingLine, Slot } from './model'
import { addDays, capitalize, dateKey, longDate, monday, plural, shortDate } from './model'
import { Empty, Sheet, Skeleton } from './ui'

const slots: [Slot, string][] = [['lunch', 'Midi'], ['dinner', 'Soir']]
type Open = { kind: 'meal'; day: string; slot: Slot } | { kind: 'recipe'; recipe: Recipe | null } | { kind: 'view'; recipe: Recipe } | { kind: 'shopping' } | null

// The family menu for one week, the recipe book behind it, and the list it adds up to.
export function Meals({ ctx }: { ctx: Ctx }) {
  const [week, setWeek] = useState(() => monday(new Date()))
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [problem, setProblem] = useState('')
  const [open, setOpen] = useState<Open>(null)
  const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(week, index)))
  const first = days[0], last = days[6]
  const { api } = ctx

  const load = useCallback(async () => {
    try {
      const [planned, book] = await Promise.all([api(`family/meals?first=${first}&last=${last}`), api('family/recipes')])
      setMeals(planned.meals); setRecipes(book.recipes); setProblem('')
    } catch (e) { setProblem(e instanceof Error ? e.message : 'Menu indisponible.') }
  }, [api, first, last])
  // Follows the app's refresh cycle, so undo, other devices and the 15 s poll all show up here.
  useEffect(() => { void load() }, [load, ctx.data?.at])

  const shift = (weeks: number) => { setMeals(null); setWeek(addDays(week, weeks * 7)) }
  const close = () => setOpen(null)
  const withRecipe = meals?.filter(meal => meal.has_recipe).length ?? 0
  async function copyLastWeek() {
    let copied = 0
    if (await ctx.run(async () => {
      copied = (await api('family/meals/copy', { method: 'POST', body: JSON.stringify({ source: dateKey(addDays(week, -7)), target: first }) })).copied
    })) { ctx.notify(copied ? `${plural(copied, 'repas')} repris de la semaine précédente.` : 'Rien à reprendre : la semaine précédente est vide ou les créneaux sont déjà pris.'); void load() }
  }

  return <>
    <div className="week-nav">
      <button className="icon-btn" aria-label="Semaine précédente" onClick={() => shift(-1)}><Icon name="back" /></button>
      <p aria-live="polite">Menu du {shortDate(first)}</p>
      <button className="icon-btn" aria-label="Semaine suivante" onClick={() => shift(1)}><Icon name="chevron" /></button>
    </div>
    {problem && <p className="banner banner-error" role="alert"><Icon name="alert" /><span>{problem}</span></p>}
    <div className="meals-actions">
      <button className="btn btn-gold" disabled={ctx.disabled || !withRecipe} onClick={() => setOpen({ kind: 'shopping' })}><Icon name="cart" />Courses du menu</button>
      <button className="btn btn-secondary" disabled={ctx.disabled || !meals} onClick={() => void copyLastWeek()}><Icon name="copy" />Reprendre la semaine précédente</button>
      {meals && !withRecipe && <p className="muted">Planifiez un repas avec une recette pour calculer les courses.</p>}
    </div>
    {!meals ? <Skeleton lines={5} /> : <ol className="menu" aria-label={`Menu de la semaine du ${shortDate(first)}`}>
      {days.map(day => <li key={day} className="menu-day">
        <h3 className={day === ctx.today ? 'is-today' : ''}>{capitalize(longDate(day))}{day === ctx.today && <span className="tag tag-strong">Aujourd’hui</span>}</h3>
        {slots.map(([slot, name]) => {
          const planned = meals.filter(meal => meal.day === day && meal.slot === slot)
          return <div className="menu-slot" key={slot}>
            <span className="menu-slot-name">{name}</span>
            <ul className="menu-dishes">
              {planned.map(meal => <li key={meal.id} className="menu-dish">
                <span><span className="row-title">{meal.title}</span>
                  <span className="row-meta"><span>{plural(meal.servings, 'personne')}</span>{!meal.has_recipe && <span>sans recette</span>}</span></span>
                {ctx.canManage(meal.created_by) && <button className="icon-btn" aria-label={`Retirer ${meal.title}, ${longDate(day)} ${name.toLowerCase()}`} disabled={ctx.disabled}
                  onClick={() => ctx.remove('meals/' + meal.id, meal.version, meal.title)}><Icon name="trash" /></button>}
              </li>)}
            </ul>
            <button className="btn-quiet" disabled={ctx.disabled} onClick={() => setOpen({ kind: 'meal', day, slot })}>
              <Icon name="plus" />{planned.length ? 'Autre plat' : 'Prévoir'}<span className="sr-only"> pour {longDate(day)} {name.toLowerCase()}</span></button>
          </div>
        })}
      </li>)}
    </ol>}

    <section className="group" aria-labelledby="recipes-title">
      <div className="section-head">
        <h2 className="group-title grow" id="recipes-title">Recettes<span>{recipes?.length ?? ''}</span></h2>
        <button className="btn btn-secondary btn-small" disabled={ctx.disabled} onClick={() => setOpen({ kind: 'recipe', recipe: null })}><Icon name="plus" />Recette</button>
      </div>
      {!recipes ? <Skeleton lines={2} /> : !recipes.length ? <Empty title="Aucune recette pour l’instant.">Ajoutez vos plats habituels avec leurs ingrédients : KARL calculera les courses selon le nombre de personnes.</Empty>
        : <ul className="rows">{recipes.map(recipe => <li className="row" key={recipe.id}>
          <button className="row-main row-open" onClick={() => setOpen({ kind: 'view', recipe })}><span className="row-text"><span className="row-title">{recipe.title}</span>
            <span className="row-meta"><span>{plural(recipe.servings, 'personne')}</span><span>{plural(recipe.ingredients.length, 'ingrédient')}</span></span></span>
            <Icon name="chevron" /></button>
          {ctx.canManage(recipe.created_by) && <>
            <button className="icon-btn" aria-label={'Modifier ' + recipe.title} disabled={ctx.disabled} onClick={() => setOpen({ kind: 'recipe', recipe })}><Icon name="edit" /></button>
            <button className="icon-btn" aria-label={'Retirer ' + recipe.title} disabled={ctx.disabled} onClick={() => ctx.remove('recipes/' + recipe.id, recipe.version, recipe.title)}><Icon name="trash" /></button>
          </>}
        </li>)}</ul>}
    </section>

    <Sheet open={!!open} title={open?.kind === 'meal' ? `${capitalize(longDate(open.day))} · ${open.slot === 'lunch' ? 'midi' : 'soir'}`
      : open?.kind === 'recipe' ? (open.recipe ? 'Modifier la recette' : 'Nouvelle recette') : open?.kind === 'view' ? open.recipe.title : 'Courses du menu'} onClose={close}>
      {open?.kind === 'view' && <RecipeView recipe={open.recipe} family={ctx.members.length}
        onEdit={ctx.canManage(open.recipe.created_by) ? () => setOpen({ kind: 'recipe', recipe: open.recipe }) : undefined} />}
      {open?.kind === 'meal' && <MealForm key={open.day + open.slot} ctx={ctx} recipes={recipes ?? []} day={open.day} slot={open.slot} onDone={() => { close(); void load() }}
        onNewRecipe={() => setOpen({ kind: 'recipe', recipe: null })} />}
      {open?.kind === 'recipe' && <RecipeForm key={open.recipe?.id ?? 'new'} ctx={ctx} recipe={open.recipe} onDone={() => { close(); void load() }} />}
      {open?.kind === 'shopping' && <ShoppingPreview ctx={ctx} first={first} last={last} onDone={close} />}
    </Sheet>
  </>
}

function MealForm({ ctx, recipes, day, slot, onDone, onNewRecipe }: {
  ctx: Ctx; recipes: Recipe[]; day: string; slot: Slot; onDone: () => void; onNewRecipe: () => void
}) {
  const [recipe, setRecipe] = useState(recipes[0]?.id ?? '')
  // Portions default to the people in the family; the recipe's own count is only the base for scaling.
  const [servings, setServings] = useState(ctx.members.length || recipes[0]?.servings || 4)
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = { day, slot, servings, recipe_id: recipe || null, title: recipe ? '' : form.get('title') }
    if (await ctx.run(async () => { await ctx.api('family/meals', { method: 'POST', body: JSON.stringify(payload) }) }, 'Repas ajouté au menu.')) onDone()
  }
  return <form className="sheet-body" onSubmit={save}>
    <div className="field"><label htmlFor="meal-recipe">Recette</label>
      <select id="meal-recipe" value={recipe} onChange={event => setRecipe(event.target.value)}>
        {recipes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        <option value="">Autre plat, sans recette</option>
      </select></div>
    {!recipe && <div className="field"><label htmlFor="meal-title">Nom du plat</label><input id="meal-title" name="title" required maxLength={120} placeholder="Restes, pizza, chez les grands-parents…" /></div>}
    <div className="field"><label htmlFor="meal-servings">Nombre de personnes</label>
      <input id="meal-servings" type="number" inputMode="numeric" min={1} max={30} value={servings} onChange={event => setServings(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></div>
    {!recipe && <p className="note"><Icon name="alert" />Un plat sans recette n’ajoute rien aux courses.</p>}
    <div className="sheet-actions">
      <button type="button" className="btn-quiet" onClick={onNewRecipe}><Icon name="plus" />Nouvelle recette</button>
      <button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Ajouter au menu</button>
    </div>
  </form>
}

function RecipeForm({ ctx, recipe, onDone }: { ctx: Ctx; recipe: Recipe | null; onDone: () => void }) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      title: form.get('title'), servings: Number(form.get('servings')), notes: form.get('notes'),
      ingredients: String(form.get('ingredients')).split('\n').map(line => line.trim()).filter(Boolean),
      ...(recipe ? { version: recipe.version } : {}),
    }
    if (await ctx.run(async () => {
      await ctx.api(recipe ? 'family/recipes/' + recipe.id : 'family/recipes', { method: recipe ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    }, recipe ? 'Recette modifiée.' : 'Recette ajoutée.')) onDone()
  }
  return <form className="sheet-body" onSubmit={save}>
    <div className="compose-row">
      <div className="field"><label htmlFor="recipe-title">Plat</label><input id="recipe-title" name="title" required maxLength={120} defaultValue={recipe?.title} /></div>
      <div className="field field-narrow"><label htmlFor="recipe-servings">Pour</label>
        <input id="recipe-servings" name="servings" type="number" inputMode="numeric" min={1} max={30} required defaultValue={recipe?.servings ?? 4} aria-describedby="recipe-servings-unit" />
        <span id="recipe-servings-unit" className="muted">personnes</span></div>
    </div>
    <div className="field"><label htmlFor="recipe-ingredients">Ingrédients, un par ligne</label>
      <textarea id="recipe-ingredients" name="ingredients" rows={7} defaultValue={recipe?.ingredients.map(item => item.line).join('\n')}
        placeholder={'250 g de farine\n4 œufs\n50 cl de lait\nsel'} aria-describedby="recipe-ingredients-help" />
      <p id="recipe-ingredients-help" className="muted">Quantité, unité puis produit : g, kg, cl, l, c. à s., boîte… KARL additionne les mêmes produits d’un repas à l’autre.</p></div>
    <div className="field"><label htmlFor="recipe-notes">Préparation <span className="optional">(facultatif)</span></label>
      <textarea id="recipe-notes" name="notes" rows={4} maxLength={4000} defaultValue={recipe?.notes} /></div>
    <div className="sheet-actions"><span /><button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Enregistrer</button></div>
  </form>
}

function ShoppingPreview({ ctx, first, last, onDone }: { ctx: Ctx; first: string; last: string; onDone: () => void }) {
  const [lines, setLines] = useState<ShoppingLine[] | null>(null)
  const [without, setWithout] = useState(0)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [problem, setProblem] = useState('')
  const { api } = ctx
  useEffect(() => {
    api(`family/meals/shopping?first=${first}&last=${last}`).then(result => {
      setLines(result.lines); setWithout(result.without_recipe)
      setChosen(new Set(result.lines.filter((line: ShoppingLine) => !line.on_list).map((line: ShoppingLine) => line.key)))
    }, e => setProblem(e instanceof Error ? e.message : 'Calcul impossible.'))
  }, [api, first, last])

  const toggle = (key: string) => setChosen(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  async function add() {
    let added = 0
    if (await ctx.run(async () => {
      added = (await api('family/meals/shopping', { method: 'POST', body: JSON.stringify({ first, last, keys: [...chosen] }) })).added
    })) { ctx.notify(added ? `${plural(added, 'article')} ajouté${added > 1 ? 's' : ''} à la liste.` : 'Rien de nouveau à ajouter.'); onDone() }
  }

  if (problem) return <div className="sheet-body"><p className="banner banner-error" role="alert"><Icon name="alert" /><span>{problem}</span></p></div>
  if (!lines) return <div className="sheet-body" aria-busy="true"><Skeleton lines={5} /></div>
  const fresh = lines.filter(line => !line.on_list)
  return <div className="sheet-body">
    <p className="muted">Ingrédients des repas du {shortDate(first)} au {shortDate(last)}, ajustés au nombre de personnes.
      {without > 0 && ` ${plural(without, 'plat')} sans recette ${without > 1 ? 'ne sont pas comptés' : 'n’est pas compté'}.`}</p>
    {!lines.length ? <Empty title="Aucun ingrédient à prévoir." /> : <ul className="rows">
      {lines.map(line => <li className="row" key={line.key}>
        <label className="row-main">
          <input type="checkbox" className="check" checked={chosen.has(line.key)} disabled={!!line.on_list} onChange={() => toggle(line.key)} />
          <span className="row-text">
            <span className="row-title">{line.name}</span>
            <span className="row-meta">{line.quantity && <strong>{line.quantity}</strong>}<span>{line.category}</span><span>{line.sources.join(', ')}</span>
              {line.on_list && <span className="tag">Déjà sur la liste · {line.on_list}</span>}</span>
          </span>
        </label>
      </li>)}
    </ul>}
    <div className="sheet-actions">
      <span className="muted">{fresh.length < lines.length ? `${plural(lines.length - fresh.length, 'produit')} déjà sur la liste, non ajouté${lines.length - fresh.length > 1 ? 's' : ''}.` : ''}</span>
      <button className="btn btn-gold" disabled={ctx.disabled || !chosen.size} onClick={() => void add()}><Icon name="plus" />Ajouter {plural(chosen.size, 'article')}</button>
    </div>
  </div>
}

const amount = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',')
const metric: Record<string, [string, number]> = { kg: ['g', 1000], g: ['g', 1], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10], ml: ['ml', 1] }
// Scaled quantities move to the clearer unit: 1 l rather than 100 cl, 1,2 kg rather than 1200 g.
function measure(quantity: number, unit: string) {
  const [base, scale] = metric[unit] ?? [unit, 1]
  const value = quantity * scale
  if (base === 'g') return value >= 1000 ? `${amount(value / 1000)} kg` : `${amount(value)} g`
  if (base === 'ml') return value >= 1000 ? `${amount(value / 1000)} l` : value >= 100 && unit !== 'ml' ? `${amount(value / 10)} cl` : `${amount(value)} ml`
  return `${amount(value)}${unit ? ' ' + unit : ''}`
}

function RecipeView({ recipe, family, onEdit }: { recipe: Recipe; family: number; onEdit?: () => void }) {
  const [people, setPeople] = useState(family || recipe.servings)
  const factor = people / recipe.servings
  return <div className="sheet-body recipe-view">
    <div className="field field-narrow"><label htmlFor="view-servings">Pour combien de personnes ?</label>
      <input id="view-servings" type="number" inputMode="numeric" min={1} max={30} value={people} onChange={event => setPeople(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /></div>
    <section aria-labelledby="view-ingredients">
      <h3 id="view-ingredients" className="group-title">Ingrédients</h3>
      {recipe.ingredients.length ? <ul>{recipe.ingredients.map((item, index) => <li key={index}>
        {item.quantity === null ? item.name : `${measure(item.quantity * factor, item.unit)} ${item.name}`}</li>)}</ul>
        : <p className="muted">Aucun ingrédient noté.</p>}
    </section>
    {recipe.notes && <section aria-labelledby="view-notes"><h3 id="view-notes" className="group-title">Préparation</h3><p className="notes">{recipe.notes}</p></section>}
    {people !== recipe.servings && <p className="note"><Icon name="alert" />Quantités recalculées depuis la recette pour {plural(recipe.servings, 'personne')}.</p>}
    {onEdit && <div className="sheet-actions"><span /><button className="btn btn-secondary" onClick={onEdit}><Icon name="edit" />Modifier</button></div>}
  </div>
}
