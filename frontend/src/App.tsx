import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

type Message = { role: 'user' | 'assistant'; content: string }
type Health = { status: string; hermes_configured: boolean; messages: number }

function initialId() {
  const existing = localStorage.getItem('karl-conversation')
  const id = existing && /^[0-9a-f-]{36}$/i.test(existing) ? existing : crypto.randomUUID()
  localStorage.setItem('karl-conversation', id)
  return id
}

export default function App() {
  const [token, setToken] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [conversationId, setConversationId] = useState(initialId)
  const [messages, setMessages] = useState<Message[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  async function api(path: string, options: RequestInit = {}, accessToken = token) {
    const response = await fetch(`/api/${path}`, {
      ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers, Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(typeof data?.detail === 'string' ? data.detail : `Erreur ${response.status}. Réessayer.`)
    }
    return response.json()
  }

  useEffect(() => {
    if (!token) return
    let active = true
    setLoading(true)
    setMessages([])
    api(`conversations/${conversationId}`).then(data => { if (active) setMessages(data.messages) })
      .catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token, conversationId])

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages, busy])

  async function connect(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api('health', {}, keyInput)
      setHealth(data)
      setToken(keyInput)
      setKeyInput('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Connexion impossible.') }
    finally { setBusy(false) }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const message = input.trim()
    if (!message || busy || loading) return
    setBusy(true)
    setError('')
    try {
      const data = await api('chat', { method: 'POST', body: JSON.stringify({ conversation_id: conversationId, message }) })
      setMessages(previous => [...previous, { role: 'user', content: message }, { role: 'assistant', content: data.reply }])
      setInput('')
      setHealth(previous => previous ? { ...previous, messages: previous.messages + 2 } : previous)
    } catch (e) { setError(e instanceof Error ? e.message : 'Envoi impossible. Réessayer.') }
    finally { setBusy(false) }
  }

  function newConversation() {
    const id = crypto.randomUUID()
    localStorage.setItem('karl-conversation', id)
    setConversationId(id)
    setInput('')
    setError('')
  }

  function speak(text: string) {
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'fr-FR'
    speechSynthesis.speak(utterance)
  }

  return <main>
    <header><div><strong className="wordmark">KARL<span>·</span></strong><p>Votre assistant personnel</p></div>
      {token && <button className="secondary" disabled={busy || loading} onClick={newConversation}>Nouvelle discussion</button>}</header>
    {!token ? <section className="welcome"><h1>Un accès à votre assistant.</h1><p>Saisissez votre clé KARL pour ouvrir la conversation.</p>
      <form onSubmit={connect}><label htmlFor="access-key">Clé d'accès KARL</label><input id="access-key" type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} required autoComplete="current-password" /><button disabled={busy || !keyInput}>{busy ? 'Connexion…' : 'Se connecter'}</button></form>
    </section> : <>
      <section className="dashboard" aria-label="Tableau de bord"><p><span>KARL</span><strong>Disponible</strong></p><p><span>Hermes</span><strong>{health?.hermes_configured ? 'Clé configurée' : 'À configurer'}</strong></p><p><span>Messages archivés</span><strong>{health?.messages ?? '—'}</strong></p></section>
      <section className="chat" aria-label="Conversation" aria-busy={busy || loading}>
        {messages.length === 0 && <div className="empty"><h1>Que souhaitez-vous faire ?</h1><p>Écrivez votre message ou dictez-le avec le clavier iPhone.</p></div>}
        {messages.map((m, i) => <article key={i} className={`message ${m.role}`}><small>{m.role === 'user' ? 'Vous' : 'KARL'}</small><p>{m.content}</p>
          {m.role === 'assistant' && 'speechSynthesis' in window && <button className="listen" onClick={() => speak(m.content)}>Écouter</button>}</article>)}
        {(busy || loading) && <p className="status" role="status">{loading ? 'Chargement…' : 'Hermes prépare sa réponse…'}</p>}<div ref={bottom} />
      </section>
      <form className="composer" onSubmit={send}><label className="sr-only" htmlFor="message">Votre message</label><textarea id="message" rows={2} value={input} onChange={e => setInput(e.target.value)} placeholder="Écrire à KARL…" maxLength={4000} disabled={busy || loading} /><button disabled={busy || loading || !input.trim()}>Envoyer</button></form>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </main>
}
