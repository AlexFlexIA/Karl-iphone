import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../icons'
import { readPreference, writePreference } from './api'
import type { Ctx } from './context'
import type { FamilyEvent, Member } from './model'
import { addDays, capitalize, clock, dateKey, declined, eventDay, fromKey, longDate, plural, shortDate, timeKey } from './model'
import { Thread } from './Thread'
import { Badge, badgeOf, ScreenHead, Skeleton } from './ui'

type Block = { event: FamilyEvent; role: 'attend' | 'drive'; start: number; end: number; row: number }

const hourOf = (value: Date, day: string) => (value.getTime() - fromKey(day).setHours(0, 0, 0, 0)) / 3600000

function layout(events: FamilyEvent[], day: string, matches: (event: FamilyEvent) => 'attend' | 'drive' | null) {
  const blocks: Block[] = []
  for (const event of events) {
    const role = matches(event)
    if (!role) continue
    const start = Math.max(0, hourOf(new Date(event.starts_at), day)), end = Math.min(24, hourOf(new Date(event.ends_at), day))
    // Overlapping activities stack on extra rows instead of hiding each other.
    let row = 0
    while (blocks.some(block => block.row === row && block.start < end && start < block.end)) row++
    blocks.push({ event, role, start, end, row })
  }
  return blocks
}

// One lane per person: who is busy, who drives and where the gaps are, at a glance.
// Solid = takes part, hatched with a car = accompanies. The list view says the same in words.
function Lanes({ ctx, events, day }: { ctx: Ctx; events: FamilyEvent[]; day: string }) {
  const hours = events.flatMap(event => [hourOf(new Date(event.starts_at), day), hourOf(new Date(event.ends_at), day)])
  const first = Math.max(0, Math.min(8, Math.floor(Math.min(...hours, 24))))
  const last = Math.min(24, Math.max(21, Math.ceil(Math.max(...hours, 0))))
  const span = last - first
  const at = (hour: number) => `${((Math.min(Math.max(hour, first), last) - first) / span) * 100}%`
  const lanes: { key: string; member: Member | null; blocks: Block[] }[] = ctx.members.map(member => ({
    key: member.id, member,
    blocks: layout(events, day, event => declined(event, member.id) ? null : event.attendees.includes(member.id) ? 'attend' : event.driver_id === member.id ? 'drive' : null),
  }))
  const everyone = layout(events, day, event => event.attendees.length ? null : 'attend')
  if (everyone.length) lanes.push({ key: 'all', member: null, blocks: everyone })
  const nowHour = day === ctx.today ? hourOf(ctx.now, day) : -1
  const showNow = nowHour >= first && nowHour <= last
  const scroller = useRef<HTMLDivElement>(null)
  const focusHour = showNow ? nowHour : Math.min(...events.map(event => hourOf(new Date(event.starts_at), day)), last)
  useEffect(() => {
    // On narrow screens, open the lanes on "now" (or the first activity) rather than at dawn.
    const node = scroller.current
    if (!node) return
    const track = node.scrollWidth - 104
    node.scrollLeft = Math.max(0, ((focusHour - first) / span) * track - 32)
  }, [day, first, span, focusHour])

  return <figure className="lanes" aria-label={`Couloirs du ${longDate(day)}, de ${first} h à ${last} h`} style={{ '--hours': span } as CSSProperties}>
    <div className="lanes-scroll" ref={scroller}>
      <div className="lanes-grid">
        <div className="lane-head" aria-hidden="true">
          <span className="lane-corner" />
          <div className="lane-ruler">
            {Array.from({ length: span + 1 }, (_, index) => first + index).filter(hour => hour % 2 === 0).map(hour => <span key={hour} style={{ left: at(hour) }}>{hour} h</span>)}
            {showNow && <span className="lane-now-label" style={{ left: at(nowHour) }}>{timeKey(ctx.now)}</span>}
          </div>
        </div>
        {lanes.map(lane => {
          const rows = Math.max(1, ...lane.blocks.map(block => block.row + 1))
          return <div className="lane" key={lane.key} role="group" aria-label={lane.member?.name ?? 'Toute la famille'}>
            <span className="lane-label">{lane.member ? <Badge member={lane.member} size={24} /> : <span className="badge-all" aria-hidden="true" />}<span>{lane.member?.name ?? 'Tous'}</span></span>
            <div className="lane-track" style={{ height: rows * 48 + 8 }}>
              {showNow && <span className="lane-now" style={{ left: at(nowHour) }} aria-hidden="true" />}
              {!lane.blocks.length && <span className="lane-free">Libre</span>}
              {lane.blocks.map(block => {
                const look = badgeOf(lane.member)
                const style = { left: at(block.start), width: `calc(${at(block.end)} - ${at(block.start)})`, top: 4 + block.row * 48, '--fill': lane.member ? look.fill : 'var(--ink)', '--fill-ink': lane.member ? look.ink : 'var(--paper)' } as CSSProperties
                const waiting = !!lane.member && block.event.replies?.[lane.member.id] === 'pending'
                const label = `${block.event.title}, ${clock(block.event.starts_at)} à ${clock(block.event.ends_at)}${block.role === 'drive' ? ', accompagne' : ''}${waiting ? ', réponse attendue' : ''}`
                const content = <>{block.role === 'drive' && <Icon name="car" />}{waiting && <Icon name="clock" />}<span>{waiting ? '? ' : ''}{block.event.title}</span></>
                return ctx.canManage(block.event.created_by)
                  ? <button key={block.event.id + block.role} className={`block block-${block.role}${waiting ? ' block-waiting' : ''}`} style={style} aria-label={label + '. Modifier'} title={label} disabled={ctx.disabled} onClick={() => ctx.editEvent(block.event)}>{content}</button>
                  : <span key={block.event.id + block.role} className={`block block-${block.role}${waiting ? ' block-waiting' : ''}`} style={style} role="img" aria-label={label} title={label}>{content}</span>
              })}
            </div>
          </div>
        })}
      </div>
    </div>
    <figcaption className="legend">
      <span><span className="legend-swatch" aria-hidden="true" />Participe</span>
      <span><span className="legend-swatch legend-drive" aria-hidden="true"><Icon name="car" /></span>Accompagne</span>
      {events.some(event => Object.values(event.replies ?? {}).includes('pending')) && <span><span className="legend-swatch legend-waiting" aria-hidden="true"><Icon name="clock" /></span>Réponse attendue</span>}
      {showNow && <span><span className="legend-now" aria-hidden="true" />Maintenant</span>}
      <span>Touchez une activité pour la modifier.</span>
    </figcaption>
  </figure>
}

export function Planning({ ctx, week, setWeek, day, setDay }: { ctx: Ctx; week: Date; setWeek: (week: Date) => void; day: string; setDay: (day: string) => void }) {
  const [mode, setMode] = useState<'list' | 'lanes'>(() => readPreference('planning-mode') === 'lanes' ? 'lanes' : 'list')
  const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(week, index)))
  const events = ctx.data?.events ?? []
  const ofDay = events.filter(event => eventDay(event) === day || (new Date(event.starts_at) < fromKey(day) && new Date(event.ends_at) > fromKey(day)))
  const choose = (next: 'list' | 'lanes') => { setMode(next); writePreference('planning-mode', next) }
  const shift = (weeks: number) => { const next = addDays(week, weeks * 7); setWeek(next); setDay(dateKey(next)) }

  return <section>
    <ScreenHead title="Planning" lede="Qui fait quoi, et qui accompagne."
      action={<button className="btn btn-primary" disabled={ctx.disabled} onClick={() => ctx.editEvent(null, day)}><Icon name="plus" />Activité</button>} />
    <div className="week-nav">
      <button className="icon-btn" aria-label="Semaine précédente" onClick={() => shift(-1)}><Icon name="back" /></button>
      <p aria-live="polite">Semaine du {shortDate(days[0])}</p>
      <button className="icon-btn" aria-label="Semaine suivante" onClick={() => shift(1)}><Icon name="chevron" /></button>
    </div>
    <div className="days" role="group" aria-label="Jour affiché">
      {days.map(key => {
        const count = events.filter(event => eventDay(event) === key).length
        const date = fromKey(key)
        return <button key={key} className="day" aria-pressed={key === day} aria-label={`${capitalize(longDate(key))}${key === ctx.today ? ", aujourd’hui" : ''}, ${count ? plural(count, 'activité') : 'aucune activité'}`} onClick={() => setDay(key)}>
          <span className="day-name">{date.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</span>
          <span className={`day-number ${key === ctx.today ? 'is-today' : ''}`}>{date.getDate()}</span>
          <span className="day-dots" aria-hidden="true">{Array.from({ length: Math.min(count, 3) }, (_, index) => <i key={index} />)}{count > 3 ? '+' : ''}</span>
        </button>
      })}
    </div>
    <div className="planning-bar">
      <h2>{capitalize(longDate(day))}</h2>
      <div className="seg" role="group" aria-label="Affichage">
        <button aria-pressed={mode === 'list'} onClick={() => choose('list')}><Icon name="list" />Liste</button>
        <button aria-pressed={mode === 'lanes'} onClick={() => choose('lanes')}><Icon name="lanes" />Couloirs</button>
      </div>
    </div>
    {!ctx.data ? <Skeleton lines={4} /> : mode === 'lanes' ? <Lanes ctx={ctx} events={ofDay} day={day} /> : <Thread ctx={ctx} events={ofDay} day={day} />}
    <p className="footnote"><a href="/api/family/calendar.ics" className="btn-quiet">Exporter les 9 prochaines semaines (.ics)<Icon name="share" /></a><br />Import ponctuel dans un autre agenda. Aucune synchronisation automatique.</p>
  </section>
}
