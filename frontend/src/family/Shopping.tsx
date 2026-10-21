import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import { readDraft, readPreference, writeDraft, writePreference } from './api'
import type { Ctx } from './context'
import { categories, plural } from './model'
import type { Item } from './model'
import { Meals } from './Meals'
import { Empty, ScreenHead, Sheet, Skeleton, useOptimistic } from './ui'

export function QuickAdd({ ctx, detailed = false }: { ctx: Ctx; detailed?: boolean }) {
  const [name, setName] = useState(() => readDraft('item'))
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState<string>('Autres')
  const [more, setMore] = useState(false)
  const id = detailed ? 'item-name' : 'item-quick'
  const update = (value: string) => { setName(value); writeDraft('item', value) }
  async function add(event: FormEvent) {
    event.preventDefault()
    const label = name.trim()
    let duplicate = false
    if (await ctx.run(async () => {
      duplicate = (await ctx.api('family/items', { method: 'POST', body: JSON.stringify({ name: label, quantity, category }) })).duplicate
    })) { update(''); setQuantity(''); ctx.notify(duplicate ? `« ${label} » est déjà sur la liste : rien n’a été ajouté.` : `« ${label} » ajouté à la liste.`) }
  }
  return <form className="quick-add" onSubmit={add}>
    <label htmlFor={id} className={detailed ? '' : 'sr-only'}>Ajouter un article</label>
    <div className="quick-add-line">
      <input id={id} value={name} onChange={event => update(event.target.value)} required maxLength={120} placeholder="Pommes, lait, pain…" autoComplete="off" enterKeyHint="done" />
      <button className="btn btn-gold" disabled={ctx.disabled || !name.trim()}><Icon name="plus" />Ajouter</button>
    </div>
    {detailed && <>
      <button type="button" className="btn-quiet" aria-expanded={more} onClick={() => setMore(value => !value)}>{more ? 'Masquer les détails' : 'Préciser la quantité ou le rayon'}</button>
      {more && <div className="compose-row">
        <div className="field"><label htmlFor="item-quantity">Quantité</label><input id="item-quantity" value={quantity} onChange={event => setQuantity(event.target.value)} maxLength={60} placeholder="2 bouteilles" /></div>
        <div className="field"><label htmlFor="item-category">Rayon</label><select id="item-category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(name => <option key={name}>{name}</option>)}</select></div>
      </div>}
    </>}
  </form>
}

export function Shopping({ ctx }: { ctx: Ctx }) {
  const items = ctx.data?.items ?? []
  const pending = items.filter(item => !item.checked)
  const basket = items.filter(item => item.checked)
  const [editing, setEditing] = useState<Item | null>(null)
  const row = (item: Item) => <ItemRow ctx={ctx} item={item} key={item.id} onEdit={() => setEditing(item)} />
  const [mode, setMode] = useState<'list' | 'meals'>(() => readPreference('shopping-mode') === 'meals' ? 'meals' : 'list')
  const choose = (next: 'list' | 'meals') => { setMode(next); writePreference('shopping-mode', next) }
  // No shop is connected from KARL: the list is copied as text, ready to paste where the order is prepared.
  function copyForDrive() {
    const text = categories.map(category => {
      const rows = pending.filter(item => item.category === category)
      return rows.length ? [category, ...rows.map(item => `- ${item.name}${item.quantity ? ' (' + item.quantity + ')' : ''}`)].join('\n') : ''
    }).filter(Boolean).join('\n\n')
    void navigator.clipboard.writeText(text).then(() => ctx.notify(`${plural(pending.length, 'article')} copié${pending.length > 1 ? 's' : ''} pour le Drive.`),
      () => ctx.notify('Copie impossible sur cet appareil.'))
  }

  const toggle = <div className="seg" role="group" aria-label="Affichage">
    <button aria-pressed={mode === 'list'} onClick={() => choose('list')}><Icon name="list" />Liste</button>
    <button aria-pressed={mode === 'meals'} onClick={() => choose('meals')}><Icon name="calendar" />Repas</button>
  </div>
  if (mode === 'meals') return <section>
    <ScreenHead title="Courses" lede="Le menu de la semaine et les recettes qui remplissent la liste." />
    <div className="planning-bar">{toggle}</div>
    <Meals ctx={ctx} />
  </section>

  return <section>
    <ScreenHead title="Courses" lede={ctx.data ? `Liste partagée par toute la famille · ${plural(pending.length, 'article')} à prendre.` : 'Chargement…'} />
    <div className="planning-bar">{toggle}</div>
    <QuickAdd ctx={ctx} detailed />
    {!ctx.data ? <Skeleton lines={4} /> : !items.length && <Empty title="La liste est vide." >Ajoutez le premier article ci-dessus.</Empty>}
    {categories.map((category, index) => {
      const rows = pending.filter(item => item.category === category)
      return rows.length ? <section className="group" key={category} aria-labelledby={'aisle-' + index}>
        <h2 className="group-title" id={'aisle-' + index}>{category}<span>{rows.length}</span></h2>
        <ul className="rows">{rows.map(row)}</ul>
      </section> : null
    })}
    {pending.length > 0 && <p className="footnote"><button className="btn-quiet" onClick={copyForDrive}><Icon name="copy" />Copier la liste pour le Drive</button><br />
      Le panier E.Leclerc Drive n’est pas encore relié à KARL : rien n’est commandé ni acheté depuis cet écran.</p>}
    <Sheet open={!!editing} title="Modifier l’article" onClose={() => setEditing(null)}>
      {editing && <ItemForm key={editing.id} ctx={ctx} item={editing} onDone={() => setEditing(null)} />}
    </Sheet>
    {basket.length > 0 && <details className="group done-group" open={!pending.length}>
      <summary className="group-title">Dans le panier<span>{basket.length}</span></summary>
      <ul className="rows">{basket.map(row)}</ul>
    </details>}
  </section>
}

function ItemRow({ ctx, item, onEdit }: { ctx: Ctx; item: Item; onEdit: () => void }) {
  const [checked, setChecked] = useOptimistic(!!item.checked, value => ctx.run(async () => {
    await ctx.api('family/items/' + item.id, { method: 'PATCH', body: JSON.stringify({ version: item.version, checked: value }) })
  }))
  return <li className={`row ${checked ? 'is-done' : ''}`}>
    <label className="row-main">
      <input type="checkbox" className="check" checked={checked} disabled={ctx.disabled} onChange={event => setChecked(event.target.checked)} />
      <span className="row-text">
        <span className="row-title">{item.name}{checked ? <span className="sr-only"> (dans le panier)</span> : null}</span>
        <span className="row-meta">{item.quantity && <strong>{item.quantity}</strong>}<span>par {item.author}</span></span>
      </span>
    </label>
    {!checked && <button className="icon-btn" aria-label={'Modifier ' + item.name} disabled={ctx.disabled} onClick={onEdit}><Icon name="edit" /></button>}
    <button className="icon-btn" aria-label={'Retirer ' + item.name} disabled={ctx.disabled} onClick={() => ctx.remove('items/' + item.id, item.version, item.name)}><Icon name="trash" /></button>
  </li>
}

function ItemForm({ ctx, item, onDone }: { ctx: Ctx; item: Item; onDone: () => void }) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (await ctx.run(async () => {
      await ctx.api('family/items/' + item.id, { method: 'PATCH', body: JSON.stringify({ version: item.version, name: form.get('name'), quantity: form.get('quantity'), category: form.get('category') }) })
    }, 'Article modifié.')) onDone()
  }
  return <form className="sheet-body" onSubmit={save}>
    <div className="field"><label htmlFor="edit-item-name">Article</label><input id="edit-item-name" name="name" required maxLength={120} defaultValue={item.name} /></div>
    <div className="compose-row">
      <div className="field"><label htmlFor="edit-item-quantity">Quantité</label><input id="edit-item-quantity" name="quantity" maxLength={60} defaultValue={item.quantity} /></div>
      <div className="field"><label htmlFor="edit-item-category">Rayon</label><select id="edit-item-category" name="category" defaultValue={item.category}>{categories.map(name => <option key={name}>{name}</option>)}</select></div>
    </div>
    <div className="sheet-actions"><span /><button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Enregistrer</button></div>
  </form>
}
