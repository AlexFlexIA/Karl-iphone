import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import { readDraft, writeDraft } from './api'
import type { Ctx } from './context'
import { categories, plural } from './model'
import type { Item } from './model'
import { Empty, ScreenHead, Skeleton, useOptimistic } from './ui'

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
    if (await ctx.run(async () => {
      await ctx.api('family/items', { method: 'POST', body: JSON.stringify({ name: label, quantity, category }) })
    }, `« ${label} » ajouté à la liste.`)) { update(''); setQuantity('') }
  }
  return <form className="quick-add" onSubmit={add}>
    <label htmlFor={id} className={detailed ? '' : 'sr-only'}>Ajouter un article</label>
    <div className="quick-add-line">
      <input id={id} value={name} onChange={event => update(event.target.value)} required maxLength={120} placeholder="Pommes, lait, pain…" autoComplete="off" enterKeyHint="done" />
      <button className="btn btn-primary" disabled={ctx.disabled || !name.trim()}><Icon name="plus" />Ajouter</button>
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
  const row = (item: Item) => <ItemRow ctx={ctx} item={item} key={item.id} />

  return <section>
    <ScreenHead title="Courses" lede={ctx.data ? `Liste partagée par toute la famille · ${plural(pending.length, 'article')} à prendre.` : 'Chargement…'} />
    <QuickAdd ctx={ctx} detailed />
    {!ctx.data ? <Skeleton lines={4} /> : !items.length && <Empty title="La liste est vide." >Ajoutez le premier article ci-dessus.</Empty>}
    {categories.map((category, index) => {
      const rows = pending.filter(item => item.category === category)
      return rows.length ? <section className="group" key={category} aria-labelledby={'aisle-' + index}>
        <h2 className="group-title" id={'aisle-' + index}>{category}<span>{rows.length}</span></h2>
        <ul className="rows">{rows.map(row)}</ul>
      </section> : null
    })}
    {basket.length > 0 && <details className="group done-group" open={!pending.length}>
      <summary className="group-title">Dans le panier<span>{basket.length}</span></summary>
      <ul className="rows">{basket.map(row)}</ul>
    </details>}
  </section>
}

function ItemRow({ ctx, item }: { ctx: Ctx; item: Item }) {
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
    <button className="icon-btn" aria-label={'Retirer ' + item.name} disabled={ctx.disabled} onClick={() => ctx.remove('items/' + item.id, item.version, item.name)}><Icon name="trash" /></button>
  </li>
}
