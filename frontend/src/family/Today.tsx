import { useEffect, useState } from 'react'
import { Icon } from '../icons'
import { readPreference, writePreference } from './api'
import type { Ctx } from './context'
import { capitalize, eventDay, longDate, plural } from './model'
import { QuickAdd } from './Shopping'
import { TaskRow } from './Tasks'
import { Thread } from './Thread'
import { Skeleton } from './ui'
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
        <section aria-labelledby="today-shopping">
          <div className="section-head"><h2 id="today-shopping">Courses</h2><button className="btn-quiet" onClick={() => ctx.go('shopping')}>{data ? `${plural(pending.length, 'article')}` : 'La liste'}<Icon name="chevron" /></button></div>
          {data && pending.length > 0 && <p className="muted">{pending.slice(0, 4).map(item => item.name).join(', ')}{pending.length > 4 ? '…' : ''}</p>}
          <QuickAdd ctx={ctx} />
        </section>
        <section aria-labelledby="today-tasks">
          <div className="section-head"><h2 id="today-tasks">Pour toi</h2><button className="btn-quiet" onClick={() => ctx.go('tasks')}>Toutes les tâches<Icon name="chevron" /></button></div>
          {!data ? <Skeleton lines={2} /> : mine.length ? <ul className="rows">{mine.slice(0, 5).map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul> : <p className="muted">Rien ne t’est attribué. </p>}
          {shared.length > 0 && <p className="muted">Et {plural(shared.length, 'tâche')} pour toute la famille.</p>}
        </section>
      </div>
    </div>
  </div>
}
