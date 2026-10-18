import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from './icons'

type User = { id: string; name: string; role: 'admin' | 'member'; is_owner: boolean }
type Member = User & { active: boolean; email?: string | null }
type Session = { user: User | null; csrf: string | null; google_enabled: boolean; preview: boolean }
type Item = { id: string; name: string; quantity: string; category: string; checked: number; version: number; author: string }
type Task = { id: string; title: string; assignee_id: string | null; due_date: string | null; done: number; created_by: string; version: number }
type Event = { id: string; title: string; starts_at: string; ends_at: string; series_starts_at: string; series_ends_at: string; attendees: string[]; driver_id: string | null; location: string; recurrence: 'once' | 'weekly'; created_by: string; version: number }
type Snapshot = { members: Member[]; items: Item[]; tasks: Task[]; events: Event[]; at: Date }
type View = 'today' | 'calendar' | 'shopping' | 'tasks' | 'members'
type Undo = { path: string; version: number; label: string }
const categories = ['Fruits et légumes', 'Frais', 'Épicerie', 'Maison', 'Autres']
const tabs = [['today', 'Aujourd’hui', 'home'], ['calendar', 'Planning', 'calendar'], ['shopping', 'Courses', 'cart'], ['tasks', 'Tâches', 'check']] as const
const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const displayDate = (value: string, weekday = false) => new Date(value.slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR', { ...(weekday ? { weekday: 'long' } as const : {}), day: 'numeric', month: 'long' })
const clock = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
function localInput(value: string) {
  const d = new Date(value)
  return `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function monday(value: Date) {
  const result = new Date(value); result.setDate(result.getDate() - (result.getDay() + 6) % 7); result.setHours(12, 0, 0, 0)
  return result
}
const authErrors: Record<string, string> = { google_unconfigured: 'La connexion Google n’est pas encore activée. Utilisez votre invitation privée.', google_denied: 'Connexion Google non terminée. Réessayez.', not_invited: 'Ce compte Google n’a pas été invité. Demandez un accès à un parent.' }

export default function FamilyApp({ onPersonal }: { onPersonal: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState<View>('today')
  const [data, setData] = useState<Snapshot | null>(null)
  const [week, setWeek] = useState(() => monday(new Date()))
  const [person, setPerson] = useState('')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState(() => authErrors[new URLSearchParams(location.search).get('auth_error') ?? ''] ?? '')
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invitation') ?? '')
  const [invitation, setInvitation] = useState('')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const [eventForm, setEventForm] = useState(false)
  const [editing, setEditing] = useState<Event | null>(null)
  const [itemName, setItemName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [category, setCategory] = useState('Autres')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [taskDate, setTaskDate] = useState('')
  const mounted = useRef(true)
  const currentScope = useRef('')
  currentScope.current = `${session?.user?.id ?? ''}|${dateKey(week)}`
  const invitationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mounted.current = true
    const url = new URL(location.href)
    if (url.hash.startsWith('#invitation=') || url.searchParams.has('auth_error')) {
      url.hash = ''; url.searchParams.delete('auth_error'); history.replaceState(null, '', url.pathname + url.search)
    }
    const controller = new AbortController()
    fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal }).then(r => {
      if (!r.ok) throw new Error('KARL est injoignable. Réessayez après reconnexion.')
      return r.json()
    }).then(result => { if (!controller.signal.aborted) setSession(result) }).catch(e => {
      if (!controller.signal.aborted) setError(e.message)
    }).finally(() => { if (!controller.signal.aborted) setBooting(false) })
    return () => { mounted.current = false; controller.abort() }
  }, [])

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    let response: Response
    try {
      response = await fetch('/api/' + path, { ...options, cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(session?.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...options.headers } })
    } catch {
      throw new Error(options.method && options.method !== 'GET' ? 'Connexion interrompue. Vérifiez la liste avant de réessayer.' : 'KARL est injoignable. Les dernières données affichées sont conservées.')
    }
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401 && mounted.current) { setSession(previous => previous ? { ...previous, user: null, csrf: null } : previous); setData(null) }
      throw new Error(typeof result?.detail === 'string' ? result.detail : response.status === 422 ? 'Vérifiez les champs du formulaire.' : 'Cette action n’a pas abouti. Actualisez puis réessayez.')
    }
    return result
  }, [session?.csrf])

  const refresh = useCallback(async () => {
    if (!session?.user) return
    const scope = `${session.user.id}|${dateKey(week)}`
    setRefreshing(true)
    const last = new Date(week); last.setDate(last.getDate() + 6)
    try {
      const [members, items, tasks, events] = await Promise.all([
        api('family/members'), api('family/items'), api('family/tasks'), api(`family/events?first=${dateKey(week)}&last=${dateKey(last)}`),
      ])
      if (mounted.current && currentScope.current === scope) setData({ ...members, ...items, ...tasks, ...events, at: new Date() })
    } catch (e) { if (mounted.current && currentScope.current === scope) setError(e instanceof Error ? e.message : 'Actualisation impossible.') }
    finally { if (mounted.current && currentScope.current === scope) setRefreshing(false) }
  }, [api, session?.user, week])
  useEffect(() => {
    if (online) void refresh()
    const timer = window.setInterval(() => { if (online && !document.hidden) void refresh() }, 15000)
    const visible = () => { if (!document.hidden && online) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh, online])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  async function action(job: () => Promise<void>, reload = true) {
    if (busy || !online) return
    setBusy(true); setError(''); setNotice('')
    try { await job() }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Action impossible.') }
    finally { if (mounted.current) { setBusy(false); if (reload) await refresh() } }
  }
  async function acceptInvite() {
    await action(async () => {
      await api('auth/invitation', { method: 'POST', body: JSON.stringify({ token: inviteToken }) })
      setInviteToken(''); setData(null); setSession(await api('auth/session')); setNotice('Bienvenue dans votre espace familial.')
    })
  }
  function navigate(next: View) { if (next === 'today' && dateKey(week) !== dateKey(monday(new Date()))) { setData(null); setWeek(monday(new Date())) }; setView(next); setError(''); setNotice(''); window.scrollTo({ top: 0 }) }
  const user = session?.user
  const members = data?.members.filter(member => member.active) ?? []
  const names = (id: string | null) => members.find(member => member.id === id)?.name ?? (id ? 'Ancien membre' : 'Toute la famille')
  const peopleClass = (id: string) => `person-color-${Math.max(0, members.findIndex(member => member.id === id)) % 4}`
  const canManage = (createdBy: string) => user?.role === 'admin' || createdBy === user?.id
  const today = dateKey(new Date())
  const draftDay = dateKey(week) === dateKey(monday(new Date())) ? today : dateKey(week)
  const todayEvents = data?.events.filter(event => dateKey(new Date(event.starts_at)) === today) ?? []
  const filteredEvents = data?.events.filter(event => !person || event.attendees.includes(person) || event.driver_id === person) ?? []
  const pendingTasks = data?.tasks.filter(task => !task.done) ?? []
  const pendingItems = data?.items.filter(item => !item.checked) ?? []
  const disabled = busy || !online

  async function remove(path: string, version: number, label: string) {
    await action(async () => {
      await api('family/' + path, { method: 'PATCH', body: JSON.stringify({ version, deleted: true }) })
      setUndo({ path, version: version + 1, label })
    })
  }
  async function addItem(event: FormEvent) {
    event.preventDefault()
    await action(async () => {
      await api('family/items', { method: 'POST', body: JSON.stringify({ name: itemName, quantity, category }) })
      setItemName(''); setQuantity('')
    })
  }
  async function createTask(event: FormEvent) {
    event.preventDefault()
    await action(async () => {
      await api('family/tasks', { method: 'POST', body: JSON.stringify({ title: taskTitle, assignee_id: taskAssignee || null, due_date: taskDate || null }) })
      setTaskTitle(''); setTaskDate('')
    })
  }
  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = { title: form.get('title'), starts_at: new Date(String(form.get('start'))).toISOString(), ends_at: new Date(String(form.get('end'))).toISOString(),
      attendees: form.getAll('attendees'), driver_id: form.get('driver') || null, location: form.get('location'), recurrence: form.get('recurrence'), ...(editing ? { version: editing.version } : {}) }
    await action(async () => {
      await api(editing ? 'family/events/' + editing.id : 'family/events', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      setEventForm(false); setEditing(null)
      if (!editing || editing.recurrence === 'once') { setData(null); setWeek(monday(new Date(payload.starts_at))) }
    })
  }
  function eventCard(event: Event, controls: boolean) {
    return <article className="family-event" key={event.id + event.starts_at}><div className="event-time"><time dateTime={event.starts_at}>{clock(event.starts_at)}</time><span>{clock(event.ends_at)}</span></div><div className="event-body"><h3>{event.title}</h3><div className="event-people">{event.attendees.map(id => <span key={id} className={peopleClass(id)}>{names(id)}</span>)}</div>{event.driver_id && <p><Icon name="car" />Accompagnement : {names(event.driver_id)}</p>}{event.location && <p>{event.location}</p>}{event.recurrence === 'weekly' && <span className="section-note">Chaque semaine</span>}{controls && canManage(event.created_by) && <div className="row-actions"><button onClick={() => { setEditing({ ...event, starts_at: event.series_starts_at, ends_at: event.series_ends_at }); setEventForm(true) }} disabled={disabled}>Modifier{event.recurrence === 'weekly' ? ' la série' : ''}</button><button onClick={() => void remove('events/' + event.id, event.version, event.title)} disabled={disabled}>Retirer{event.recurrence === 'weekly' ? ' la série' : ''}</button></div>}</div></article>
  }
  function taskRow(task: Task) {
    return <div className={`family-task ${task.done ? 'is-done' : ''}`} key={task.id}><label><input type="checkbox" checked={!!task.done} disabled={disabled} onChange={e => void action(async () => { await api('family/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ version: task.version, done: e.target.checked }) }) })} /><span><strong>{task.title}</strong><small>{names(task.assignee_id)}{task.due_date ? ' · ' + displayDate(task.due_date) : ''}</small></span></label>{canManage(task.created_by) && <button className="icon-button" aria-label={'Retirer ' + task.title} disabled={disabled} onClick={() => void remove('tasks/' + task.id, task.version, task.title)}><Icon name="close" /></button>}</div>
  }

  return <div className={`app-shell family-shell ${user ? 'authenticated' : 'signed-out'}`}>
    <header className="masthead"><div className="identity"><a className="wordmark" href="#" onClick={e => { e.preventDefault(); navigate('today') }} aria-label="KARL, accueil famille">KARL<span>·</span></a><p>Notre espace familial</p></div>{user ? <div className="header-actions"><button className="member-button" onClick={() => navigate('members')}><Icon name="people" /><span>{user.name}</span></button>{user.is_owner && <button className="icon-button" onClick={onPersonal} aria-label="Assistant personnel"><Icon name="chat" /></button>}<button className="icon-button" aria-label="Se déconnecter" disabled={busy} onClick={() => void action(async () => { await api('auth/logout', { method: 'POST' }); setSession(previous => previous ? { ...previous, user: null, csrf: null } : previous); setData(null); setInvitation(''); setUndo(null) }, false)}><Icon name="logout" /></button></div> : <button className="secondary-button" onClick={onPersonal}>Espace personnel</button>}</header>
    {session?.preview && <p className="preview-banner">Version de test · données séparées de votre espace habituel</p>}
    {!online && <p className="offline-banner" role="status"><Icon name="offline" />Hors ligne. Les dernières données restent affichées ; reconnectez-vous pour modifier.</p>}
    {error && <div className="error-banner" role="alert"><p>{error}</p><button onClick={() => setError('')}>Fermer</button></div>}
    {notice && <p className="family-notice" role="status">{notice}</p>}
    {undo && user && <div className="undo-bar" role="status"><span>« {undo.label} » retiré.</span><button disabled={disabled} onClick={() => void action(async () => { await api('family/' + undo.path, { method: 'PATCH', body: JSON.stringify({ version: undo.version, deleted: false }) }); setUndo(null) })}>Annuler</button><button aria-label="Fermer l’annulation" onClick={() => setUndo(null)}><Icon name="close" /></button></div>}
    {booting ? <p className="loading-state" role="status">Ouverture de votre espace…</p> : !user ? <main className="login-layout"><div className="login-art" aria-hidden="true"><span>K<span className="art-slash">/</span></span><div className="art-caption">Nos journées.<br />Nos idées.<br />Ensemble.</div></div><section className="welcome family-welcome"><h1>La vie de famille,<br />au même endroit.</h1><p>Le planning, les courses et les petits coups de main du quotidien.</p>{inviteToken ? <><h2>Une place vous attend.</h2><p>Ce lien personnel ouvre votre compte familial sur cet appareil.</p><button className="primary-button" disabled={disabled} onClick={() => void acceptInvite()}>{busy ? 'Ouverture…' : 'Accepter mon invitation'}<Icon name="chevron" /></button></> : <>{session?.google_enabled ? <a className="primary-button google-login" href="/api/auth/google/start">Continuer avec Google<Icon name="chevron" /></a> : <p className="invite-explanation">Pour rejoindre la famille, ouvrez le lien d’invitation qu’un parent vous a transmis.</p>}<p className="privacy-note">Votre session familiale reste ouverte jusqu’à 30 jours sur cet appareil. Vous pouvez vous déconnecter à tout moment.</p></>}<button className="text-button" onClick={onPersonal}>Je gère KARL : ouvrir mon espace personnel<Icon name="chevron" /></button></section></main> : <>
      <nav className="family-nav" aria-label="Navigation familiale">{tabs.map(([id, label, icon]) => <button key={id} className={view === id ? 'selected' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav>
      <main className="workspace family-workspace">
        <div className="family-sync"><span>{data ? `Actualisé à ${data.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : refreshing ? 'Chargement…' : 'Données à charger'}</span><button onClick={() => { setError(''); void refresh() }} disabled={refreshing || !online} aria-label="Actualiser la famille"><Icon name="refresh" className={refreshing ? 'rotating' : ''} /></button></div>
        {view === 'today' && <section className="family-today"><div className="family-heading"><h1>Notre journée.</h1><p>{displayDate(today, true)}</p></div><div className="family-day-layout"><section className="day-agenda"><h2>Qui fait quoi ?</h2>{todayEvents.length ? todayEvents.map(event => eventCard(event, false)) : <div className="family-empty"><p>{data ? 'Le planning est libre aujourd’hui.' : 'Lecture du planning…'}</p><button className="secondary-button" onClick={() => { setWeek(monday(new Date())); navigate('calendar'); setEventForm(true); setEditing(null) }}>Ajouter une activité<Icon name="plus" /></button></div>}<button className="text-button" onClick={() => { setWeek(monday(new Date())); navigate('calendar') }}>Voir la semaine<Icon name="chevron" /></button></section><aside className="day-side"><button className="shopping-shortcut" onClick={() => navigate('shopping')}><Icon name="cart" /><span><strong>{data ? `${pendingItems.length} article${pendingItems.length > 1 ? 's' : ''}` : 'Les courses'}</strong><small>à prendre pour la maison</small></span><Icon name="chevron" /></button><section><h2>Un coup de main ?</h2>{pendingTasks.slice(0, 4).map(taskRow)}{!pendingTasks.length && <p className="section-note">{data ? 'Aucune tâche en attente.' : 'Chargement…'}</p>}<button className="text-button" onClick={() => navigate('tasks')}>Toutes les tâches<Icon name="chevron" /></button></section></aside></div></section>}
        {view === 'shopping' && <section><div className="family-heading"><h1>On n’oublie rien.</h1><p>Une liste commune, à remplir et cocher ensemble.</p></div><form className="family-form shopping-form" onSubmit={addItem}><div><label htmlFor="item-name">À acheter</label><input id="item-name" value={itemName} onChange={e => setItemName(e.target.value)} required maxLength={120} placeholder="Pain, lait, pommes…" /></div><div className="form-pair"><div><label htmlFor="item-quantity">Quantité</label><input id="item-quantity" value={quantity} onChange={e => setQuantity(e.target.value)} maxLength={60} placeholder="2 bouteilles" /></div><div><label htmlFor="item-category">Rayon</label><select id="item-category" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(name => <option key={name}>{name}</option>)}</select></div></div><button className="primary-button" disabled={disabled || !itemName.trim()}>Ajouter à la liste<Icon name="plus" /></button></form>
          {!data?.items.length && <p className="family-empty">{data ? 'La liste est vide. Ajoutez le premier article.' : 'Chargement de la liste…'}</p>}{[...categories, 'Dans le panier'].map(group => {
            const rows = data?.items.filter(item => group === 'Dans le panier' ? item.checked : !item.checked && item.category === group) ?? []
            return rows.length ? <section className="shopping-group" key={group}><h2>{group}<span>{rows.length}</span></h2>{rows.map(item => <div className={`shopping-row ${item.checked ? 'is-done' : ''}`} key={item.id}><label><input type="checkbox" checked={!!item.checked} disabled={disabled} onChange={e => void action(async () => { await api('family/items/' + item.id, { method: 'PATCH', body: JSON.stringify({ version: item.version, checked: e.target.checked }) }) })} /><span><strong>{item.name}</strong><small>{item.quantity ? item.quantity + ' · ' : ''}Modifié par {item.author}</small></span></label><button className="icon-button" disabled={disabled} onClick={() => void remove('items/' + item.id, item.version, item.name)} aria-label={'Retirer ' + item.name}><Icon name="close" /></button></div>)}</section> : null
          })}</section>}
        {view === 'calendar' && <section><div className="family-heading"><h1>Chacun sa place.</h1><p>Activités et accompagnements de la famille. Horaires du téléphone.</p></div><div className="planning-controls"><div className="week-switch"><button className="icon-button" aria-label="Semaine précédente" onClick={() => { const d = new Date(week); d.setDate(d.getDate() - 7); setData(null); setWeek(d) }}><Icon name="back" /></button><span>Semaine du {displayDate(dateKey(week))}</span><button className="icon-button" aria-label="Semaine suivante" onClick={() => { const d = new Date(week); d.setDate(d.getDate() + 7); setData(null); setWeek(d) }}><Icon name="chevron" /></button></div><button className="secondary-button" onClick={() => { setEditing(null); setEventForm(value => !value) }}><Icon name="plus" />Une activité</button></div><label className="sr-only" htmlFor="planning-person">Filtrer par personne</label><select id="planning-person" className="person-filter" value={person} onChange={e => setPerson(e.target.value)}><option value="">Toute la famille</option>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select>
          {eventForm && <form className="family-form event-form" key={editing?.id ?? 'new'} onSubmit={saveEvent}><h2>{editing ? 'Modifier ' + (editing.recurrence === 'weekly' ? 'la série' : 'l’activité') : 'Une nouvelle activité'}</h2>{editing?.recurrence === 'weekly' && <p className="section-note">Les changements concernent toute la série, depuis le {displayDate(dateKey(new Date(editing.starts_at)))}.</p>}<label htmlFor="event-title">Activité</label><input id="event-title" name="title" required maxLength={160} defaultValue={editing?.title ?? ''} placeholder="Sport, rendez-vous, sortie…" /><div className="form-pair"><div><label htmlFor="event-start">Début</label><input id="event-start" name="start" type="datetime-local" required defaultValue={editing ? localInput(editing.starts_at) : draftDay + 'T17:00'} /></div><div><label htmlFor="event-end">Fin</label><input id="event-end" name="end" type="datetime-local" required defaultValue={editing ? localInput(editing.ends_at) : draftDay + 'T18:00'} /></div></div><fieldset><legend>Qui participe ?</legend>{members.map(member => <label className="attendee-option" key={member.id}><input type="checkbox" name="attendees" value={member.id} defaultChecked={editing ? editing.attendees.includes(member.id) : member.id === user.id} /><span className={peopleClass(member.id)}>{member.name}</span></label>)}</fieldset><div className="form-pair"><div><label htmlFor="event-driver">Qui accompagne ?</label><select id="event-driver" name="driver" defaultValue={editing?.driver_id ?? ''}><option value="">À organiser</option>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></div><div><label htmlFor="event-repeat">Répétition</label><select id="event-repeat" name="recurrence" defaultValue={editing?.recurrence ?? 'once'}><option value="once">Une seule fois</option><option value="weekly">Chaque semaine</option></select></div></div><label htmlFor="event-location">Lieu (facultatif)</label><input id="event-location" name="location" maxLength={160} defaultValue={editing?.location ?? ''} /><div className="form-actions"><button className="primary-button" disabled={disabled}>Enregistrer<Icon name="check" /></button><button type="button" className="secondary-button" onClick={() => { setEventForm(false); setEditing(null) }}>Annuler</button></div></form>}
          {!filteredEvents.length && <p className="family-empty">{data ? 'Aucune activité pour cette semaine et ce filtre.' : 'Lecture du planning…'}</p>}{Array.from(new Set(filteredEvents.map(event => dateKey(new Date(event.starts_at))))).map(day => <section className="planning-day" key={day}><h2>{displayDate(day, true)}</h2>{filteredEvents.filter(event => dateKey(new Date(event.starts_at)) === day).map(event => eventCard(event, true))}</section>)}<a className="text-button calendar-export" href="/api/family/calendar.ics">Exporter les 9 prochaines semaines (.ics)<Icon name="arrow" /></a><p className="section-note">Export ponctuel à importer dans un calendrier. La synchronisation Google Agenda n’est pas activée.</p></section>}
        {view === 'tasks' && <section><div className="family-heading"><h1>On se partage ça.</h1><p>Les petits coups de main font les grandes journées.</p></div><form className="family-form" onSubmit={createTask}><label htmlFor="task-title">À faire</label><input id="task-title" value={taskTitle} onChange={e => setTaskTitle(e.target.value)} required maxLength={160} placeholder="Préparer les affaires, sortir les poubelles…" /><div className="form-pair"><div><label htmlFor="task-assignee">Pour qui ?</label><select id="task-assignee" value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)}><option value="">Toute la famille</option>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></div><div><label htmlFor="task-date">Pour quand ? (facultatif)</label><input id="task-date" type="date" value={taskDate} onChange={e => setTaskDate(e.target.value)} /></div></div><button className="primary-button" disabled={disabled || !taskTitle.trim()}>Ajouter la tâche<Icon name="plus" /></button></form><div className="task-list">{data?.tasks.map(taskRow)}{!data?.tasks.length && <p className="family-empty">{data ? 'Aucune tâche pour le moment.' : 'Chargement…'}</p>}</div></section>}
        {view === 'members' && <section><div className="family-heading"><h1>Notre équipe.</h1><p>Un accès personnel pour chacun.</p></div><div className="member-list">{data?.members.map(member => <div key={member.id}><span className={'member-avatar ' + peopleClass(member.id)}>{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><span>{member.role === 'admin' ? 'Administrateur' : 'Membre'}{!member.active ? ' · Accès désactivé' : ''}</span>{member.email && <span>{member.email}</span>}</div>{user.role === 'admin' && !member.is_owner && member.id !== user.id && <button className="secondary-button" disabled={disabled} onClick={() => void action(async () => { await api('family/members/' + member.id, { method: 'PATCH', body: JSON.stringify({ active: !member.active }) }); setNotice(member.active ? 'Accès désactivé sur tous les appareils.' : 'Accès réactivé. Vous pouvez créer une nouvelle invitation.') })}>{member.active ? 'Désactiver' : 'Réactiver'}</button>}</div>)}</div>
          {user.is_owner && <details className="family-settings"><summary>Mon nom et mon adresse Google</summary><form className="family-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action(async () => { await api('family/profile', { method: 'PATCH', body: JSON.stringify({ name: form.get('name'), email: form.get('email') }) }); setSession(await api('auth/session')); setNotice('Votre profil a été enregistré.') }) }}><label htmlFor="profile-name">Votre prénom</label><input id="profile-name" name="name" defaultValue={user.name} required maxLength={60} /><label htmlFor="profile-email">Votre adresse Google</label><input id="profile-email" name="email" type="email" autoComplete="email" defaultValue={data?.members.find(member => member.id === user.id)?.email ?? ''} required /><button className="primary-button" disabled={disabled}>Enregistrer mon profil<Icon name="check" /></button></form></details>}
          {user.role === 'admin' && <><form className="family-form invite-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void action(async () => { const result = await api('family/invitations', { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), role: form.get('role') }) }); setInvitation(result.url); setNotice('Invitation créée. Transmettez ce lien en privé à la personne concernée.') }) }}><h2>Inviter un proche</h2><label htmlFor="invite-name">Prénom</label><input id="invite-name" name="name" required maxLength={60} placeholder="Prénom" /><label htmlFor="invite-email">Adresse Gmail</label><input id="invite-email" name="email" type="email" required autoComplete="off" placeholder="prenom@gmail.com" /><label htmlFor="invite-role">Accès</label><select id="invite-role" name="role"><option value="member">Membre · planning, courses et tâches</option><option value="admin">Administrateur · gestion de la famille</option></select><button className="primary-button" disabled={disabled}>Créer l’invitation<Icon name="plus" /></button></form>{invitation && <div className="invitation-result"><label htmlFor="invitation-link">Lien d’invitation privé</label><input ref={invitationRef} id="invitation-link" readOnly value={invitation} /><p>Valable 7 jours, utilisable une fois. Une nouvelle invitation pour la même adresse remplace l’ancien lien.</p><button className="secondary-button" onClick={() => { void navigator.clipboard.writeText(invitation).then(() => setNotice('Lien copié.'), () => { invitationRef.current?.select(); setNotice('Sélectionnez le lien et copiez-le.') }) }}><Icon name="copy" />Copier le lien</button></div>}<p className="section-note">{session.google_enabled ? 'Les adresses invitées peuvent aussi utiliser « Continuer avec Google ».' : 'Les invitations privées fonctionnent dès maintenant. La connexion Google sera disponible après sa configuration.'}</p></>}
        </section>}
        <p className="family-footer">Cet espace partage uniquement le planning, les courses et les tâches. L’assistant personnel reste privé.</p>
      </main></>}
  </div>
}
