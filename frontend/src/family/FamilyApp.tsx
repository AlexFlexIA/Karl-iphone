import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../icons'
import { Assistant } from './Assistant'
import { Logo } from './Logo'
import { ApiError, readPreference, request } from './api'
import type { Ctx } from './context'
import { EventForm } from './EventForm'
import { Me } from './Me'
import type { FamilyEvent, Session, Snapshot, View } from './model'
import { addDays, dateKey, monday, remindsMe, timeKey } from './model'
import { Planning } from './Planning'
import { Shopping } from './Shopping'
import { Tasks } from './Tasks'
import { Today } from './Today'
import { Sheet } from './ui'
import { Welcome } from './Welcome'
import './family.css'

type Undo = { path: string; version: number; label: string }
type InstallPrompt = Event & { prompt: () => Promise<void> }
const tabs = [['today', 'Aujourd’hui', 'home'], ['planning', 'Planning', 'calendar'], ['shopping', 'Courses', 'cart'], ['tasks', 'Tâches', 'check'], ['assistant', 'Hermes', 'chat'], ['me', 'Moi', 'people']] as const
const authErrors: Record<string, string> = {
  google_unconfigured: 'La connexion Google n’est pas encore activée. Utilisez votre invitation privée.',
  google_denied: 'Connexion Google non terminée. Réessayez.',
  not_invited: 'Ce compte Google n’a pas été invité. Demandez un accès à un parent.',
}

export default function FamilyApp({ onPersonal }: { onPersonal: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [booting, setBooting] = useState(true)
  const [view, setView] = useState<View>('today')
  const [data, setData] = useState<Snapshot | null>(null)
  const [week, setWeek] = useState(() => monday(new Date()))
  const [day, setDay] = useState(() => dateKey(new Date()))
  const [now, setNow] = useState(() => new Date())
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState(() => authErrors[new URLSearchParams(location.search).get('auth_error') ?? ''] ?? '')
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const [sheet, setSheet] = useState<{ event: FamilyEvent | null; day: string } | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [inviteToken, setInviteToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('invitation') ?? '')
  const mounted = useRef(true)
  const scope = useRef('')
  const user = session?.user ?? null
  scope.current = `${user?.id ?? ''}|${dateKey(week)}`

  useEffect(() => {
    mounted.current = true
    const url = new URL(location.href)
    if (url.hash.startsWith('#invitation=') || url.searchParams.has('auth_error')) {
      url.hash = ''; url.searchParams.delete('auth_error'); history.replaceState(null, '', url.pathname + url.search)
    }
    const controller = new AbortController()
    request('auth/session', null, { signal: controller.signal }).then(result => setSession(result))
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setBooting(false) })
    const onUpdate = () => setUpdateReady(true)
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    const onLine = () => setOnline(navigator.onLine)
    const tick = window.setInterval(() => setNow(new Date()), 30000)
    window.addEventListener('karl:update', onUpdate)
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('online', onLine); window.addEventListener('offline', onLine)
    return () => {
      mounted.current = false; controller.abort(); window.clearInterval(tick)
      window.removeEventListener('karl:update', onUpdate); window.removeEventListener('beforeinstallprompt', onInstall)
      window.removeEventListener('online', onLine); window.removeEventListener('offline', onLine)
    }
  }, [])

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    try { return await request(path, session?.csrf ?? null, options) }
    catch (e) {
      if (e instanceof ApiError && e.status === 401 && mounted.current) { setSession(previous => previous && { ...previous, user: null, csrf: null }); setData(null) }
      throw e
    }
  }, [session?.csrf])

  const refresh = useCallback(async () => {
    if (!user) return
    const current = `${user.id}|${dateKey(week)}`
    setRefreshing(true)
    try {
      const [members, items, tasks, events, pending, meals] = await Promise.all([
        api('family/members'), api('family/items'), api('family/tasks'), api(`family/events?first=${dateKey(week)}&last=${dateKey(addDays(week, 6))}`),
        api('family/events/pending'), api(`family/meals?first=${dateKey(week)}&last=${dateKey(addDays(week, 6))}`),
      ])
      if (mounted.current && scope.current === current) { setData({ ...members, ...items, ...tasks, ...events, ...meals, pending: pending.events, at: new Date() }); setNow(new Date()) }
    } catch (e) { if (mounted.current && scope.current === current) setError(e instanceof Error ? e.message : 'Actualisation impossible.') }
    finally { if (mounted.current) setRefreshing(false) }
  }, [api, user, week])

  useEffect(() => {
    if (online) void refresh()
    const timer = window.setInterval(() => { if (online && !document.hidden) void refresh() }, 15000)
    const visible = () => { if (!document.hidden && online) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh, online])

  async function run(job: () => Promise<void>, success = '') {
    if (busy || !online) return false
    setBusy(true); setError(''); setNotice('')
    let ok = false
    try { await job(); ok = true; if (success && mounted.current) setNotice(success) }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Action impossible.') }
    finally { if (mounted.current) { setBusy(false); await refresh() } }
    return ok
  }

  function go(next: View) {
    if (next === 'today' && dateKey(week) !== dateKey(monday(new Date()))) { setData(null); setWeek(monday(new Date())) }
    setView(next); setError(''); setNotice(''); window.scrollTo({ top: 0 })
    document.getElementById('main')?.focus({ preventScroll: true })
  }
  function changeWeek(next: Date) { setData(null); setWeek(monday(next)) }

  // Reminders fire while KARL is open: a toast, plus a system notification if this device allowed it.
  useEffect(() => {
    if (!user || !data) return
    let seen: string[] = []
    try { seen = JSON.parse(localStorage.getItem('karl-reminded') ?? '[]') } catch { /* Storage blocked: may repeat once. */ }
    const fresh = data.tasks.filter(task => remindsMe(task, user.id) && new Date(task.remind_at!) <= now && !seen.includes(task.id + task.remind_at))
    if (!fresh.length) return
    setNotice(fresh.length > 1 ? `Rappels : ${fresh.map(task => task.title).join(', ')}` : `Rappel : ${fresh[0].title}`)
    if ('Notification' in window && Notification.permission === 'granted' && readPreference('notifications') === 'on') {
      for (const task of fresh) { try { new Notification('KARL · rappel', { body: task.title, tag: task.id }) } catch { /* iOS without push: the toast is enough. */ } }
    }
    try { localStorage.setItem('karl-reminded', JSON.stringify([...seen, ...fresh.map(task => task.id + task.remind_at)].slice(-200))) } catch { /* Convenience only. */ }
  }, [data, now, user])

  const members = useMemo(() => data?.members.filter(member => member.active) ?? [], [data])
  const disabled = busy || !online
  const ctx: Ctx | null = user && {
    user, data, members, today: dateKey(now), now, online, disabled, api, run, go,
    find: id => data?.members.find(member => member.id === id),
    notify: message => setNotice(message),
    remove: (path, version, label) => void run(async () => {
      await api('family/' + path, { method: 'PATCH', body: JSON.stringify({ version, deleted: true }) })
      setUndo({ path, version: version + 1, label })
    }),
    editEvent: (event, eventDay) => setSheet({ event, day: eventDay ?? day }),
    canManage: createdBy => user.role === 'admin' || createdBy === user.id,
  }

  async function acceptInvite() {
    await run(async () => {
      await api('auth/invitation', { method: 'POST', body: JSON.stringify({ token: inviteToken }) })
      setInviteToken(''); setData(null); setSession(await request('auth/session', null))
    }, 'Bienvenue dans le carnet de la famille.')
  }
  async function signOut() {
    await run(async () => {
      await api('auth/logout', { method: 'POST' })
      setSession(previous => previous && { ...previous, user: null, csrf: null }); setData(null); setUndo(null); setView('today')
    })
  }

  const status = !online ? null : refreshing && !data ? 'Chargement…' : data ? `À jour · ${timeKey(data.at)}` : ''

  return <div className={`fam ${user ? 'is-signed-in' : ''}`}>
    <a className="skip" href="#main">Aller au contenu</a>
    {user && <nav className="tabbar" aria-label="Navigation principale">
      <span className="tabbar-brand" aria-hidden="true"><Logo size={34} /></span>
      {tabs.map(([id, label, icon]) => <button key={id} className="tab" aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}><Icon name={icon} />{id === 'today' ? <><span className="tab-long">{label}</span><span className="tab-short">Accueil</span></> : <span>{label}</span>}</button>)}
    </nav>}
    <div className="fam-main">
      {user && <div className="family-brand"><Logo size={36} caption="Espace famille" /></div>}
      <div className="banners">
        {session?.preview && <p className="banner banner-info"><Icon name="alert" />Version de test · données séparées de l’espace habituel.</p>}
        {!online && <p className="banner banner-offline" role="status"><Icon name="offline" /><span><strong>Hors ligne.</strong> {data ? `Données de ${timeKey(data.at)}, en lecture seule.` : 'Aucune donnée chargée.'} Les modifications reprendront à la reconnexion ; rien n’est mis en attente.</span></p>}
        {updateReady && <div className="banner banner-info" role="status"><Icon name="refresh" /><span>Une nouvelle version de KARL est prête. Vos saisies en cours seront conservées.</span><button className="btn btn-secondary btn-small" onClick={() => location.reload()}>Recharger</button></div>}
        {error && <div className="banner banner-error" role="alert"><Icon name="alert" /><span>{error}</span><button className="icon-btn" aria-label="Fermer le message" onClick={() => setError('')}><Icon name="close" /></button></div>}
      </div>
      {booting ? <main id="main" tabIndex={-1} className="booting" aria-busy="true"><p className="muted">Ouverture du carnet…</p></main>
        : !user || !ctx ? <Welcome invitation={!!inviteToken} googleEnabled={!!session?.google_enabled} busy={busy} online={online} onAccept={() => void acceptInvite()} onPersonal={onPersonal} />
          : <main id="main" tabIndex={-1} aria-busy={refreshing && !data}>
            {status && <p className="sync"><span>{status}</span><button className="icon-btn" aria-label="Actualiser" disabled={refreshing} onClick={() => { setError(''); void refresh() }}><Icon name="refresh" className={refreshing ? 'rotating' : ''} /></button></p>}
            {view === 'today' && <Today ctx={ctx} />}
            {view === 'planning' && <Planning ctx={ctx} week={week} setWeek={changeWeek} day={day} setDay={setDay} />}
            {view === 'shopping' && <Shopping ctx={ctx} />}
            {view === 'tasks' && <Tasks ctx={ctx} />}
            {view === 'assistant' && <Assistant ctx={ctx} />}
            {view === 'me' && <Me ctx={ctx} googleEnabled={!!session?.google_enabled} installPrompt={installPrompt} onPersonal={onPersonal} onSignOut={() => void signOut()}
              onProfile={async () => setSession(await request('auth/session', null))} />}
          </main>}
    </div>
    <div className="toasts" aria-live="polite">
      {undo && user ? <div className="toast"><span>« {undo.label} » retiré.</span>
        <button disabled={disabled} onClick={() => void run(async () => { await api('family/' + undo.path, { method: 'PATCH', body: JSON.stringify({ version: undo.version, deleted: false }) }); setUndo(null) })}>Annuler</button>
        <button className="icon-btn" aria-label="Fermer" onClick={() => setUndo(null)}><Icon name="close" /></button></div>
        : notice ? <div className="toast"><Icon name="check" /><span>{notice}</span><button className="icon-btn" aria-label="Fermer" onClick={() => setNotice('')}><Icon name="close" /></button></div> : null}
    </div>
    {ctx && <Sheet open={!!sheet} title={sheet?.event ? 'Modifier l’activité' : 'Nouvelle activité'} onClose={() => setSheet(null)}>
      {sheet && <EventForm key={sheet.event?.id ?? 'new' + sheet.day} ctx={ctx} event={sheet.event} day={sheet.day}
        onDone={next => { setSheet(null); if (view === 'planning') { setDay(next); if (dateKey(monday(new Date(next + 'T12:00:00'))) !== dateKey(week)) changeWeek(new Date(next + 'T12:00:00')) } }} />}
    </Sheet>}
  </div>
}
