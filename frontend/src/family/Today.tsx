import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { readPreference, writePreference } from './api'
import type { Ctx } from './context'
import { capitalize, clock, dateKey, eventDay, longDate, plural } from './model'
import type { FamilyEvent } from './model'
import { QuickAdd } from './Shopping'
import { TaskRow } from './Tasks'
import { Thread } from './Thread'
import { Person, Skeleton } from './ui'
import { Weather } from './Weather'

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function Today({ ctx }: { ctx: Ctx }) {
  const { data, user, today } = ctx
  const [installHint, setInstallHint] = useState(false)
  useEffect(() => { setInstallHint(!standalone() && readPreference('install-hint') !== 'hidden') }, [])
  const events = data?.events.filter(event => eventDay(event) === today) ?? []
  const pending = data?.items.filter(item => !item.checked) ?? []
  const mine = data?.tasks.filter(task => !task.done && task.assignee_id === user.id) ?? []
  const shared = data?.tasks.filter(task => !task.done && !task.assignee_id) ?? []
  const invites = data?.pending ?? []
  const toReview = user.role === 'admin' ? data?.tasks.filter(task => task.key_task && !task.done && task.submitted_by) ?? [] : []
  const meals = data?.meals.filter(meal => meal.day === today) ?? []
  const menu = ([['lunch', 'Midi'], ['dinner', 'Soir']] as const).map(([slot, name]) => [name, meals.filter(meal => meal.slot === slot).map(meal => meal.title).join(', ')] as const)
    .filter(([, dishes]) => dishes)
  const hour = ctx.now.getHours()
  const greeting = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour'
  const summary = !data ? 'Lecture de la journée…' : [
    events.length ? plural(events.length, 'activité') : 'aucune activité',
    pending.length ? plural(pending.length, 'course') : 'aucune course',
    mine.length ? plural(mine.length, 'tâche') + ' pour toi' : 'rien pour toi',
  ].join(', ').replace(/^./, letter => letter.toUpperCase()) + '.'

  return <div className="today">
    <header className="screen-head">
      <div><p className="eyebrow">{capitalize(longDate(today))}</p><h1>{greeting} {user.name}.</h1><p className="lede" aria-live="polite">{summary}</p></div>
    </header>
    {installHint && <aside className="hint" aria-label="Installation">
      <Icon name="share" />
      <div><p>Ajoute KARL à ton écran d’accueil pour l’ouvrir comme une app.</p><button className="btn-quiet" onClick={() => ctx.go('me')}>Voir comment</button></div>
      <button className="icon-btn" aria-label="Masquer ce conseil" onClick={() => { writePreference('install-hint', 'hidden'); setInstallHint(false) }}><Icon name="close" /></button>
    </aside>}
    <Weather ctx={ctx} />
    <div className="today-grid">
      <section aria-labelledby="today-thread" className="today-thread">
        <div className="section-head"><h2 id="today-thread">Fil du jour</h2><button className="btn-quiet" onClick={() => ctx.go('planning')}>Voir la semaine<Icon name="chevron" /></button></div>
        {data ? <Thread ctx={ctx} events={events} day={today} /> : <Skeleton />}
      </section>
      <div className="today-side">
        <section aria-labelledby="today-menu">
          <div className="section-head"><h2 id="today-menu">Au menu</h2><button className="btn-quiet" onClick={() => { writePreference('shopping-mode', 'meals'); ctx.go('shopping') }}>Menu de la semaine<Icon name="chevron" /></button></div>
          {!data ? <Skeleton lines={1} /> : menu.length ? <ul className="today-menu">{menu.map(([slot, dishes]) => <li key={slot}>
            <span className="menu-slot-name">{slot}</span><span>{dishes}</span></li>)}</ul> : <p className="muted">Rien de prévu pour aujourd’hui.</p>}
        </section>
        <section aria-labelledby="today-shopping">
          <div className="section-head"><h2 id="today-shopping">Courses</h2><button className="btn-quiet" onClick={() => ctx.go('shopping')}>{data ? `${plural(pending.length, 'article')}` : 'La liste'}<Icon name="chevron" /></button></div>
          {data && pending.length > 0 && <p className="muted">{pending.slice(0, 4).map(item => item.name).join(', ')}{pending.length > 4 ? '…' : ''}</p>}
          <QuickAdd ctx={ctx} />
        </section>
        {invites.length > 0 && <section aria-labelledby="today-invites" className="today-invites">
          <div className="section-head"><h2 id="today-invites">Invitations</h2><span className="muted">{plural(invites.length, 'réponse attendue', 'réponses attendues')}</span></div>
          <ul className="rows">{invites.map(event => <Invitation ctx={ctx} event={event} key={event.id} />)}</ul>
        </section>}
        {toReview.length > 0 && <section aria-labelledby="today-review" className="today-review">
          <div className="section-head"><h2 id="today-review">À valider</h2><button className="btn-quiet" onClick={() => ctx.go('tasks')}>{plural(toReview.length, 'tâche clé', 'tâches clés')}<Icon name="chevron" /></button></div>
          <ul className="rows">{toReview.slice(0, 5).map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul>
        </section>}
        <section aria-labelledby="today-tasks">
          <div className="section-head"><h2 id="today-tasks">Pour toi</h2><button className="btn-quiet" onClick={() => ctx.go('tasks')}>Toutes les tâches<Icon name="chevron" /></button></div>
          {!data ? <Skeleton lines={2} /> : mine.length ? <ul className="rows">{mine.slice(0, 5).map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul> : <p className="muted">Rien ne t’est attribué. </p>}
          {shared.length > 0 && <p className="muted">Et {plural(shared.length, 'tâche')} pour toute la famille.</p>}
        </section>
      </div>
    </div>
  </div>
}

const weekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function Invitation({ ctx, event }: { ctx: Ctx; event: FamilyEvent }) {
  const start = new Date(event.series_starts_at)
  const when = event.recurrence === 'weekly' ? `Chaque ${weekdays[start.getDay()]}, ${clock(event.series_starts_at)}–${clock(event.series_ends_at)}`
    : `${capitalize(longDate(dateKey(start)))}, ${clock(event.series_starts_at)}–${clock(event.series_ends_at)}`
  const role = event.driver_id === ctx.user.id && !event.attendees.includes(ctx.user.id) ? 'pour accompagner' : 'pour participer'
  const answer = (value: 'yes' | 'no') => void ctx.run(async () => {
    await ctx.api(`family/events/${event.id}/reply`, { method: 'POST', body: JSON.stringify({ answer: value }) })
  }, value === 'yes' ? `C’est noté : tu participes à « ${event.title} ».` : `Réponse envoyée : tu déclines « ${event.title} ».`)
  return <li className="row invitation-row">
    <span className="row-text">
      <span className="row-title">{event.title}</span>
      <span className="row-meta"><span>{when}</span>{event.location && <span><Icon name="pin" />{event.location}</span>}</span>
      <span className="row-meta"><Person member={ctx.find(event.created_by)} fallback="Un membre" /><span>t’invite {role}</span></span>
    </span>
    <span className="review-actions">
      <button className="btn btn-gold btn-small" disabled={ctx.disabled} onClick={() => answer('yes')}><Icon name="check" />Accepter<span className="sr-only"> « {event.title} »</span></button>
      <button className="btn btn-secondary btn-small" disabled={ctx.disabled} onClick={() => answer('no')}><Icon name="close" />Décliner<span className="sr-only"> « {event.title} »</span></button>
    </span>
  </li>
}
