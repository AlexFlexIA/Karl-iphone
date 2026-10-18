import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from './icons'
import { useVoice } from './useVoice'
import { CronDashboard } from './CronDashboard'

type Message = { role: 'user' | 'assistant'; content: string }
type Conversation = { id: string; title: string; updated_at: string; messages: number }
type Overview = {
  hermes: { status: 'connected' | 'unavailable' | 'unauthorized' | 'not_configured'; latency_ms: number | null }
  messages: number; conversations: number; busy: boolean; checked_at: string; last_message_at: string | null
}
type View = 'chat' | 'history' | 'dashboard'
const statusNames = { connected: 'Hermes connecté', unavailable: 'Hermes injoignable', unauthorized: 'Clé Hermes refusée', not_configured: 'Hermes à configurer' }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function initialId() {
  const saved = localStorage.getItem('karl-conversation')
  const id = saved && uuidPattern.test(saved) ? saved : crypto.randomUUID()
  localStorage.setItem('karl-conversation', id)
  return id
}
function dateLabel(value: string, withTime = false) {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.valueOf()) ? 'Date inconnue' : date.toLocaleString('fr-FR', withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' })
}
function Reply({ text }: { text: string }) {
  return <div className="reply-content">{text.split(/(```[\s\S]*?(?:```|$))/g).map((part, i) => {
    if (!part.startsWith('```')) return <p key={i}>{part}</p>
    const code = part.slice(3).replace(/```$/, '')
    const newline = code.indexOf('\n')
    return <pre key={i}><code>{newline >= 0 ? code.slice(newline + 1) : code}</code></pre>
  })}</div>
}

export default function App({ onFamily }: { onFamily?: () => void }) {
  const [token, setToken] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [view, setView] = useState<View>('chat')
  const [dashboardView, setDashboardView] = useState<'today' | 'home' | 'system'>('today')
  const [conversationId, setConversationId] = useState(initialId)
  const [messages, setMessages] = useState<Message[]>([])
  const [messageTotal, setMessageTotal] = useState(0)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [pending, setPending] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [copied, setCopied] = useState<number | null>(null)
  const voice = useVoice(input, setInput, setError)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const activeToken = useRef(token)
  activeToken.current = token

  const api = useCallback(async (path: string, options: RequestInit = {}, accessToken = token) => {
    let response: Response
    try {
      response = await fetch(`/api/${path}`, {
        ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${accessToken}` },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new Error(options.method === 'POST'
        ? 'Connexion interrompue. Vérifiez Hermes avant de renvoyer : la demande peut continuer côté serveur.'
        : 'KARL est injoignable. Vérifiez que l’application et votre liaison privée sont démarrées.')
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      if (response.status === 401 && token && activeToken.current === accessToken) setToken('')
      throw new Error(typeof data?.detail === 'string' ? data.detail : `Erreur ${response.status}. Réessayez.`)
    }
    return response.json()
  }, [token])

  const refreshStatus = useCallback(async () => {
    if (!token) return
    setProbing(true)
    try { const data = await api('status'); if (activeToken.current === token) setOverview(data) }
    catch (e) { if (activeToken.current === token) { setOverview(null); setError(e instanceof Error ? e.message : 'Statut indisponible.') } }
    finally { if (activeToken.current === token) setProbing(false) }
  }, [api, token])

  const refreshHistory = useCallback(async (offset = 0) => {
    if (!token) return
    setHistoryLoading(true)
    try {
      const data = await api(`conversations?offset=${offset}&limit=30`)
      if (activeToken.current !== token) return
      setConversations(previous => offset ? [...previous, ...data.conversations.filter((item: Conversation) => !previous.some(p => p.id === item.id))] : data.conversations)
      setHasMore(data.has_more)
    } catch (e) { if (activeToken.current === token) setError(e instanceof Error ? e.message : 'Historique indisponible.') }
    finally { if (activeToken.current === token) setHistoryLoading(false) }
  }, [api, token])

  useEffect(() => {
    if (!token) return
    void refreshStatus()
    void refreshHistory()
  }, [token, refreshStatus, refreshHistory])

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    setLoading(true); setMessages([])
    api(`conversations/${conversationId}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setMessages(data.messages); setMessageTotal(data.total) }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, token, conversationId])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])
  useEffect(() => { if (view === 'chat' && (messages.length || pending)) bottom.current?.scrollIntoView({ block: 'end' }) }, [messages, pending, view])
  useEffect(() => { if (view !== 'chat') window.scrollTo({ top: 0 }) }, [view])
  useEffect(() => {
    if (!pending) return
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [pending])
  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await api('health', {}, keyInput.trim()); setToken(keyInput.trim()); setKeyInput('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Connexion impossible. Vérifiez que KARL est démarré.') }
    finally { setBusy(false) }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const message = input.trim()
    if (!message || busy || loading || voice.listening || !online) return
    voice.stopMedia(); setBusy(true); setPending(message); setInput(''); setError('')
    try {
      const data = await api('chat', { method: 'POST', body: JSON.stringify({ conversation_id: conversationId, message }) })
      setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: data.reply }])
      setMessageTotal(previous => previous + 2)
      void refreshHistory(); void refreshStatus()
    } catch (e) {
      setInput(message)
      setError(e instanceof Error ? e.message : 'Connexion interrompue. Vérifiez Hermes avant de renvoyer votre message.')
    } finally { setBusy(false); setPending('') }
  }

  function openConversation(id: string) {
    voice.stopMedia(); localStorage.setItem('karl-conversation', id)
    setConversationId(id); setView('chat'); setInput(''); setError('')
  }
  function newConversation() { if (!busy && !loading) openConversation(crypto.randomUUID()) }
  function changeView(next: View) { voice.stopMedia(); setView(next); setError('') }
  async function openFamily() {
    if (token) {
      try { await api('family/bootstrap', { method: 'POST' }) }
      catch (e) { setError(e instanceof Error ? e.message : 'Espace famille indisponible.'); return }
    }
    voice.stopMedia(); onFamily?.()
  }
  function logout() { voice.stopMedia(); setToken(''); setMessages([]); setConversations([]); setOverview(null); setInput(''); setError(''); setView('chat'); setLoading(false) }
  async function copyMessage(text: string, id: number) {
    try { await navigator.clipboard.writeText(text); setCopied(id) }
    catch { setError('Copie indisponible. Sélectionnez le texte pour le copier.') }
  }
  function suggestion(text: string) { setInput(text); textarea.current?.focus() }
  const connected = overview?.hermes.status === 'connected'
  const connectionLabel = !online ? 'Hors ligne' : overview ? statusNames[overview.hermes.status] : probing ? 'Vérification…' : 'Connexion à vérifier'
  const filtered = conversations.filter(item => item.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))

  return <div className={`app-shell ${token ? 'authenticated' : 'signed-out'}`}>
    <header className="masthead"><div className="identity"><a className="wordmark" href="#" onClick={event => { event.preventDefault(); if (token) changeView('chat') }} aria-label="KARL, accueil">KARL<span>·</span></a><p>Votre assistant personnel</p></div>
      {token ? <div className="header-actions">{onFamily && <button className="icon-button" onClick={() => void openFamily()} aria-label="Ouvrir la famille" disabled={busy}><Icon name="people" /></button>}<span className={`connection-chip ${connected && online ? 'is-connected' : ''}`}><span />{connectionLabel}</span><button className="icon-button" onClick={logout} disabled={busy} aria-label="Se déconnecter"><Icon name="logout" /></button></div>
        : <button className="secondary-button" onClick={() => onFamily?.()}>Espace famille</button>}
    </header>
    {!online && <p className="offline-banner" role="status"><Icon name="offline" />Vous êtes hors ligne. Reconnectez-vous pour échanger avec Hermes.</p>}
    {!token ? <main className="login-layout"><div className="login-art" aria-hidden="true"><span>K<span className="art-slash">/</span></span><div className="art-caption">L’esprit libre.<br />Les idées en mouvement.</div></div><section className="welcome"><h1>Une idée ?<br />On commence.</h1><p>Ouvrez votre espace pour parler à Hermes, retrouver vos échanges et faire avancer vos idées.</p><form onSubmit={connect}><label htmlFor="access-key">Votre clé d’accès KARL</label><input id="access-key" type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} placeholder="Coller votre clé" required autoComplete="current-password" /><button className="primary-button" disabled={busy || !keyInput.trim() || !online}>{busy ? 'Connexion…' : 'Ouvrir mon espace'}<Icon name="chevron" /></button></form><p className="privacy-note">La clé reste en mémoire dans cet onglet. Elle n’est pas enregistrée sur cet appareil.</p></section></main>
      : <>
        <div className="workspace-bar"><nav aria-label="Navigation principale">{([['chat', 'Conversation', 'chat'], ['history', 'Historique', 'history'], ['dashboard', 'Dashboard', 'dashboard']] as const).map(([id, label, icon]) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => changeView(id)}><Icon name={icon} /><span>{label}</span></button>)}</nav><button className="new-conversation" aria-label="Nouvelle discussion" onClick={newConversation} disabled={busy || loading}><Icon name="plus" /><span>Nouvelle discussion</span></button></div>
        <main className="workspace">
          {view === 'chat' && <div className="conversation-layout"><section className="chat" aria-label="Conversation" aria-busy={busy || loading}>
            {!messages.length && !pending && !loading && <div className="empty-state"><span className="graphic-arrow" aria-hidden="true"><Icon name="arrow" /></span><h1>On commence<br />par quoi ?</h1><p>Une question, une idée, quelque chose à débloquer.<br />Écrivez à KARL ou dictez votre message.</p><div className="suggestions">{['Aide-moi à organiser ma journée.', 'Aide-moi à clarifier une idée.', 'Je voudrais résumer un texte.'].map(text => <button key={text} onClick={() => suggestion(text)}>{text}<Icon name="chevron" /></button>)}</div></div>}
            {messageTotal > messages.length && <p className="subtle">Les {messages.length} derniers messages sont affichés.</p>}
            {loading && <p className="loading-state" role="status"><span className="spinner" />Chargement de la conversation…</p>}
            {messages.map((message, index) => <article key={index} className={`message ${message.role}`}><div className="message-author">{message.role === 'assistant' && <span className="avatar" aria-hidden="true">K</span>}<span>{message.role === 'user' ? 'Vous' : 'KARL'}</span></div><Reply text={message.content} />{message.role === 'assistant' && <div className="message-actions"><button onClick={() => copyMessage(message.content, index)}><Icon name={copied === index ? 'check' : 'copy'} />{copied === index ? 'Copié' : 'Copier'}</button>{voice.canSpeak && <button aria-pressed={voice.speaking === index} onClick={() => voice.speak(message.content, index)}><Icon name={voice.speaking === index ? 'stop' : 'sound'} />{voice.speaking === index ? 'Arrêter' : 'Écouter'}</button>}</div>}</article>)}
            {pending && <><article className="message user pending"><div className="message-author">Vous</div><Reply text={pending} /></article><p className="loading-state" role="status"><span className="spinner" />Hermes prépare sa réponse… <span className="elapsed">{elapsed}s</span></p></>}<div ref={bottom} />
          </section><div className="compose-area"><form className={`composer ${voice.listening ? 'is-listening' : ''}`} onSubmit={send}><label className="sr-only" htmlFor="message">Votre message</label><textarea ref={textarea} id="message" rows={2} value={input} onChange={event => setInput(event.target.value)} placeholder={voice.listening ? 'Je vous écoute…' : 'Écrire à KARL…'} maxLength={4000} disabled={busy || loading || voice.listening} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} /><div className="composer-controls"><div>{voice.canDictate ? <button type="button" className={`dictate-button ${voice.listening ? 'recording' : ''}`} disabled={busy || loading || !online} onClick={() => { setError(''); voice.toggleDictation() }} aria-pressed={voice.listening}><Icon name={voice.listening ? 'stop' : 'mic'} />{voice.listening ? 'Arrêter la dictée' : 'Dicter'}</button> : <span className="keyboard-hint"><Icon name="mic" />Dictée via le clavier iPhone</span>}</div><span className="character-count">{input.length > 3500 ? `${input.length}/4000` : ''}</span><button className="send-button" disabled={busy || loading || voice.listening || !input.trim() || !online} aria-label="Envoyer le message"><Icon name="arrow" /></button></div></form><p className="composer-note">{voice.listening ? 'Vérifiez le texte avant de l’envoyer.' : voice.canDictate ? 'La dictée peut utiliser le service vocal de votre navigateur.' : 'Relisez votre message avant de l’envoyer à Hermes.'}</p></div></div>}
          {view === 'history' && <section className="history-view"><div className="section-heading"><div><h1>Les idées<br />restent ici.</h1><p>Reprenez une conversation là où vous l’avez laissée.</p></div><button className="secondary-button" onClick={() => refreshHistory()} disabled={historyLoading || busy}><Icon name="refresh" className={historyLoading ? 'rotating' : ''} /><span>Actualiser</span></button></div><label className="sr-only" htmlFor="history-search">Rechercher dans les titres chargés</label><input id="history-search" className="history-search" placeholder="Rechercher une conversation chargée…" type="search" value={search} onChange={event => setSearch(event.target.value)} />
            {historyLoading && !conversations.length && <p className="loading-state" role="status">Chargement de l’historique…</p>}
            {!historyLoading && !filtered.length && <div className="history-empty"><Icon name="history" /><p>{search ? 'Aucune conversation chargée ne correspond.' : 'Votre première conversation apparaîtra ici.'}</p></div>}
            <div className="conversation-list">{filtered.map(item => <button className="history-item" key={item.id} disabled={busy || loading} onClick={() => openConversation(item.id)}><div><span className="history-title">{item.title}</span><span className="history-meta">{dateLabel(item.updated_at)} · {item.messages} messages{item.id === conversationId ? ' · En cours' : ''}</span></div><Icon name="chevron" /></button>)}</div>{hasMore && <button className="secondary-button load-more" onClick={() => refreshHistory(conversations.length)} disabled={historyLoading}>{historyLoading ? 'Chargement…' : 'Charger la suite'}</button>}</section>}
          {view === 'dashboard' && <><nav className="dashboard-tabs" aria-label="Vues du dashboard">{([['today', 'Aujourd’hui'], ['home', 'Maison'], ['system', 'Connexion']] as const).map(([id, label]) => <button key={id} aria-current={dashboardView === id ? 'page' : undefined} className={dashboardView === id ? 'selected' : ''} onClick={() => setDashboardView(id)}>{label}</button>)}</nav>{dashboardView !== 'system' ? <CronDashboard view={dashboardView} api={api} online={online} /> : <section className="dashboard-view"><div className="section-heading"><div><h1>Au contact<br />d’Hermes.</h1><p>L’état de votre assistant, sans détour.</p></div><button className="secondary-button" onClick={() => { setError(''); void refreshStatus() }} disabled={probing || !online}><Icon name="refresh" className={probing ? 'rotating' : ''} /><span>{probing ? 'Vérification…' : 'Actualiser'}</span></button></div><div className="dashboard-grid"><div className={`connection-panel ${connected ? 'connected' : ''}`}><div className="connection-symbol" aria-hidden="true"><span>K</span><span className="connection-line" /><span>H</span></div><h2>{connectionLabel}</h2><p>{connected ? 'Le point d’accès Hermes répond avec votre clé serveur.' : overview?.hermes.status === 'unauthorized' ? 'Vérifiez la clé API Hermes côté serveur.' : 'Vérifiez que Hermes et votre liaison privée sont démarrés, puis actualisez.'}</p><div className="connection-details"><span>Dernière vérification</span><strong>{overview ? dateLabel(overview.checked_at, true) : 'Non vérifié'}</strong></div></div><div className="stats-panel"><dl><div><dt>Conversations</dt><dd>{overview?.conversations ?? '—'}</dd></div><div><dt>Messages archivés</dt><dd>{overview?.messages ?? '—'}</dd></div><div><dt>Temps de réponse API</dt><dd>{overview?.hermes.latency_ms != null ? <>{overview.hermes.latency_ms}<small> ms</small></> : '—'}</dd></div><div><dt>Échange KARL en cours</dt><dd className="text-value">{pending || overview?.busy ? 'Oui' : 'Non'}</dd></div></dl></div></div><div className="dashboard-footnote"><Icon name="history" /><p>Vos échanges sont conservés dans l’historique KARL. Le statut vérifie l’API ; il ne lance aucune action de l’assistant.</p></div><details className="install-help"><summary>Installer sur l’écran d’accueil iPhone</summary><p>Depuis une adresse HTTPS accessible à votre iPhone : ouvrez KARL dans Safari, touchez Partager, puis « Sur l’écran d’accueil ». L’adresse localhost de votre Mac n’est pas accessible depuis l’iPhone.</p></details></section>}</>}
        </main>
      </>}
    {error && <div className="error-banner" role="alert"><p>{error}</p><button onClick={() => setError('')} aria-label="Fermer le message">Fermer</button></div>}
  </div>
}
