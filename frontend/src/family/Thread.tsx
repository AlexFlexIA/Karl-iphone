import { Fragment } from 'react'
import { Icon } from '../icons'
import type { Ctx } from './context'
import type { FamilyEvent } from './model'
import { clock, timeKey } from './model'
import { Empty, Person } from './ui'

// The day as a ruled notebook page: one line per activity, and a written
// "Maintenant" line so the current moment never depends on colour.
export function Thread({ ctx, events, day }: { ctx: Ctx; events: FamilyEvent[]; day: string }) {
  const isToday = day === ctx.today
  const nowIndex = isToday ? events.findIndex(event => new Date(event.starts_at) > ctx.now) : -1
  const nowRow = <div className="thread-now" role="note"><span className="thread-time">{timeKey(ctx.now)}</span><span><Icon name="chevron" />Maintenant</span></div>
  if (!events.length) return <div className="thread">
    {isToday && nowRow}
    <Empty title={isToday ? 'Rien de prévu aujourd’hui.' : 'Rien de prévu ce jour-là.'}>
      <button className="btn btn-secondary" disabled={ctx.disabled} onClick={() => ctx.editEvent(null, day)}><Icon name="plus" />Ajouter une activité</button>
    </Empty>
  </div>
  return <ol className="thread" aria-label="Activités du jour">
    {events.map((event, index) => {
      const start = new Date(event.starts_at), end = new Date(event.ends_at)
      const state = !isToday ? '' : end <= ctx.now ? 'past' : start <= ctx.now ? 'live' : ''
      const driver = ctx.find(event.driver_id)
      const body = <>
        <span className="thread-time">{clock(event.starts_at)}<small>{clock(event.ends_at)}</small></span>
        <span className="thread-body">
          <span className="thread-title">{event.title}</span>
          {state === 'past' && <span className="tag">Terminé</span>}
          {state === 'live' && <span className="tag tag-strong"><Icon name="clock" />En cours</span>}
          <span className="thread-meta">
            {event.attendees.length ? event.attendees.map(id => <Person key={id} member={ctx.find(id)} fallback="Ancien membre" />) : <Person member={null} />}
          </span>
          {event.driver_id && <span className="thread-meta"><Icon name="car" /><span>{driver?.name ?? 'Ancien membre'} accompagne</span></span>}
          {!event.driver_id && event.attendees.length > 0 && <span className="thread-meta"><Icon name="car" /><span>Accompagnement à organiser</span></span>}
          {event.location && <span className="thread-meta"><Icon name="pin" /><span>{event.location}</span></span>}
          {event.recurrence === 'weekly' && <span className="thread-meta"><Icon name="refresh" /><span>Chaque semaine</span></span>}
        </span>
      </>
      return <Fragment key={event.id + event.starts_at}>
        {index === nowIndex && <li>{nowRow}</li>}
        <li className={`thread-row ${state ? 'is-' + state : ''}`}>
          {ctx.canManage(event.created_by)
            ? <button className="thread-hit" disabled={ctx.disabled} onClick={() => ctx.editEvent(event)} aria-label={`${event.title}, ${clock(event.starts_at)} à ${clock(event.ends_at)}. Modifier`}>{body}<Icon name="edit" className="thread-edit" /></button>
            : <div className="thread-hit">{body}</div>}
        </li>
      </Fragment>
    })}
    {isToday && nowIndex === -1 && <li>{nowRow}</li>}
  </ol>
}
