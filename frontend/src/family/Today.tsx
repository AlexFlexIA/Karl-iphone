import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { readPreference, writePreference } from './api'
import type { Ctx } from './context'
import { addDays, capitalize, clock, dateKey, eventDay, fromKey, longDate, onDay, plural, remindsMe } from './model'
import type { FamilyEvent, ShoppingLine } from './model'
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
  // A nudge KARL computes itself: menu ingredients for the coming week that nobody has put on the list yet.
  // Recomputed when the menu or the list changes, and every five minutes for recipe edits and next week's days.
  const menuSignature = [data?.meals.map(meal => meal.id + meal.version).join(), data?.items.map(item => item.id + item.version).join(),
    Math.floor(ctx.now.getTime() / 300000)].join('|')
  const [missing, setMissing] = useState<ShoppingLine[]>([])
  const { api } = ctx
  useEffect(() => {
    let live = true
    api(`family/meals/shopping?first=${today}&last=${dateKey(addDays(fromKey(today), 6))}`)
      .then(result => { if (live) setMissing(result.lines.filter((line: ShoppingLine) => !line.on_list)) }, () => { if (live) setMissing([]) })
    return () => { live = false }
  }, [api, today, menuSignature])
  const events = data?.events.filter(event => onDay(event, today)) ?? []
  const pending = data?.items.filter(item => !item.checked) ?? []
  const mine = data?.tasks.filter(task => !task.done && task.assignee_id === user.id) ?? []
  const shared = data?.tasks.filter(task => !task.done && !task.assignee_id) ?? []
  const invites = data?.pending ?? []
  const toReview = user.role === 'admin' ? data?.tasks.filter(task => task.key_task && !task.done && task.submitted_by) ?? [] : []
  const sunday = dateKey(addDays(fromKey(today), (7 - fromKey(today).getDay()) % 7))
  const weekEvents = data?.events.filter(event => eventDay(event) >= today && eventDay(event) <= sunday
    && (event.attendees.includes(user.id) || event.driver_id === user.id)).length ?? 0
  const weekTasks = mine.filter(task => task.due_date && task.due_date >= today && task.due_date <= sunday).length
  const lateTasks = mine.filter(task => task.due_date && task.due_date < today).length
  const freeEvenings = Array.from({ length: 7 }, (_, index) => dateKey(addDays(fromKey(today), index))).filter(day => day <= sunday)
    .filter(day => !data?.meals.some(meal => meal.day === day && meal.slot === 'dinner'))
    .map(day => fromKey(day).toLocaleDateString('fr-FR', { weekday: 'long' }))
  const ringing = data?.tasks.filter(task => remindsMe(task, user.id) && new Date(task.remind_at!) <= ctx.now) ?? []
  const meals = data?.meals.filter(meal => meal.day === today) ?? []
  const menu = ([['lunch', 'Midi'], ['dinner', 'Soir']] as const).map(([slot, name]) => [name, meals.filter(meal => meal.slot === slot).map(meal => meal.title).join(', ')] as const)
    .filter(([, dishes]) => dishes)
  const dinner = meals.filter(meal => meal.slot === 'dinner').map(meal => meal.title).join(' et ')
  const hour = ctx.now.getHours()
  const greeting = hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour'
  const summary = !data ? 'Lecture de la journée…' : [
    events.length ? plural(events.length, 'activité') : 'aucune activité',
    pending.length ? plural(pending.length, 'course') : 'aucune course',
    mine.length ? plural(mine.length, 'tâche') + ' pour toi' : 'rien pour toi',
    ...(dinner ? [dinner + ' ce soir'] : []),
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
    {ringing.length > 0 && <aside className="reminders" aria-labelledby="today-reminders">
      <h2 id="today-reminders"><Icon name="clock" />{ringing.length > 1 ? 'Rappels' : 'Rappel'}</h2>
      <ul className="rows">{ringing.map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul>
    </aside>}
    {missing.length > 0 && <aside className="hint" aria-label="Suggestion">
      <Icon name="cart" />
      <div><p>{plural(missing.length, 'ingrédient')} du menu des 7 prochains jours {missing.length > 1 ? 'ne sont pas' : 'n’est pas'} sur la liste : {missing.slice(0, 3).map(line => line.name.toLowerCase()).join(', ')}{missing.length > 3 ? '…' : '.'}</p>
        <button className="btn-quiet" onClick={() => { writePreference('shopping-mode', 'meals'); ctx.go('shopping') }}>Préparer les courses du menu</button></div>
      <span />
    </aside>}
    <Weather ctx={ctx} />
    <div className="today-grid">
      <section aria-labelledby="today-thread" className="today-thread">
        <div className="section-head"><h2 id="today-thread">Fil du jour</h2><button className="btn-quiet" onClick={() => ctx.go('planning')}>Voir la semaine<Icon name="chevron" /></button></div>
        {data ? <Thread ctx={ctx} events={events} day={today} /> : <Skeleton />}
      </section>
      <div className="today-side">
        {data && <section aria-labelledby="today-week" className="week-glance">
          <div className="section-head"><h2 id="today-week">Ta semaine</h2></div>
          <ul className="glance">
            <li><strong>{weekEvents}</strong> {weekEvents > 1 ? 'activités te concernent' : 'activité te concerne'}</li>
            <li><strong>{weekTasks}</strong> {weekTasks > 1 ? 'tâches à rendre' : 'tâche à rendre'} d’ici dimanche{lateTasks > 0 && <span className="due due-late"> · <Icon name="alert" />{lateTasks} en retard</span>}</li>
            <li>{freeEvenings.length ? <><strong>{freeEvenings.length}</strong> {freeEvenings.length > 1 ? 'soirs' : 'soir'} sans repas prévu : {freeEvenings.join(', ')} <button className="btn-quiet" onClick={() => { writePreference('shopping-mode', 'meals'); ctx.go('shopping') }}>Prévoir</button></> : 'Tous les soirs ont un repas prévu.'}</li>
          </ul>
        </section>}
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
