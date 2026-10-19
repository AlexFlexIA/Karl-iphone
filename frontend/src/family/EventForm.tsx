import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import type { Ctx } from './context'
import type { FamilyEvent } from './model'
import { addDays, dateKey, fromKey, timeKey } from './model'
import { Badge } from './ui'

export function EventForm({ ctx, event, day, onDone }: { ctx: Ctx; event: FamilyEvent | null; day: string; onDone: (day: string) => void }) {
  // A weekly series is edited from its first occurrence, as the API expects.
  const start = event ? new Date(event.series_starts_at) : null
  const end = event ? new Date(event.series_ends_at) : null
  const [date, setDate] = useState(start ? dateKey(start) : day)
  const [from, setFrom] = useState(start ? timeKey(start) : '17:00')
  const [to, setTo] = useState(end ? timeKey(end) : '18:00')
  const [attendees, setAttendees] = useState<string[]>(event ? event.attendees : [ctx.user.id])
  const overnight = to <= from

  async function save(submit: FormEvent<HTMLFormElement>) {
    submit.preventDefault()
    const form = new FormData(submit.currentTarget)
    const startsAt = new Date(`${date}T${from}`)
    const endsAt = new Date(`${overnight ? dateKey(addDays(fromKey(date), 1)) : date}T${to}`)
    const payload = {
      title: form.get('title'), starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), attendees,
      driver_id: form.get('driver') || null, location: form.get('location'), recurrence: form.get('recurrence'),
      ...(event ? { version: event.version } : {}),
    }
    if (await ctx.run(async () => {
      await ctx.api(event ? 'family/events/' + event.id : 'family/events', { method: event ? 'PUT' : 'POST', body: JSON.stringify(payload) })
    }, event ? 'Activité modifiée.' : 'Activité ajoutée au planning.')) onDone(date)
  }

  return <form className="sheet-body" onSubmit={save}>
    {event?.recurrence === 'weekly' && <p className="note"><Icon name="refresh" />Les changements s’appliquent à toute la série hebdomadaire.</p>}
    <div className="field"><label htmlFor="event-title">Activité</label>
      <input id="event-title" name="title" required maxLength={160} defaultValue={event?.title ?? ''} placeholder="Basket, dentiste, anniversaire…" /></div>
    <div className="compose-row compose-row-3">
      <div className="field"><label htmlFor="event-date">Jour</label><input id="event-date" type="date" required value={date} onChange={change => setDate(change.target.value)} /></div>
      <div className="field"><label htmlFor="event-from">Début</label><input id="event-from" type="time" required value={from} onChange={change => setFrom(change.target.value)} /></div>
      <div className="field"><label htmlFor="event-to">Fin</label><input id="event-to" type="time" required value={to} onChange={change => setTo(change.target.value)} aria-describedby={overnight ? 'event-overnight' : undefined} /></div>
    </div>
    {overnight && <p className="note" id="event-overnight"><Icon name="clock" />Se termine le lendemain à {to}.</p>}
    <fieldset className="chips"><legend>Qui participe ?</legend>
      {ctx.members.map(member => <label className="chip" key={member.id}>
        <input type="checkbox" checked={attendees.includes(member.id)} onChange={change => setAttendees(list => change.target.checked ? [...list, member.id] : list.filter(id => id !== member.id))} />
        <Badge member={member} size={22} />{member.name}</label>)}
    </fieldset>
    <div className="compose-row">
      <div className="field"><label htmlFor="event-driver">Qui accompagne ?</label>
        <select id="event-driver" name="driver" defaultValue={event?.driver_id ?? ''}><option value="">À organiser</option>{ctx.members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></div>
      <div className="field"><label htmlFor="event-repeat">Répétition</label>
        <select id="event-repeat" name="recurrence" defaultValue={event?.recurrence ?? 'once'}><option value="once">Une seule fois</option><option value="weekly">Chaque semaine</option></select></div>
    </div>
    <div className="field"><label htmlFor="event-location">Lieu <span className="optional">facultatif</span></label><input id="event-location" name="location" maxLength={160} defaultValue={event?.location ?? ''} /></div>
    <div className="sheet-actions">
      <button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Enregistrer</button>
      {event && <button type="button" className="btn btn-danger" disabled={ctx.disabled} onClick={() => { ctx.remove('events/' + event.id, event.version, event.title); onDone(day) }}><Icon name="trash" />Retirer{event.recurrence === 'weekly' ? ' la série' : ''}</button>}
    </div>
  </form>
}
