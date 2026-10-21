import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { Icon } from '../icons'
import { readDraft, writeDraft } from './api'
import type { Ctx } from './context'
import { capitalize, clock, dateKey, longDate, plural } from './model'
import { Empty, Person, ScreenHead, Skeleton } from './ui'

type Proposal = {
  kind?: 'event' | 'task' | 'item' | 'memory' | 'meal' | 'recipe'; title: string; event_id?: string | null; ref?: string | null
  starts_at?: string; ends_at?: string; location?: string; attendees?: string[]
  due_date?: string | null; assignee_id?: string | null; quantity?: string; category?: string
  repeat?: 'none' | 'weekly'; day?: string; slot?: 'lunch' | 'dinner'; servings?: number; ingredients?: string[]; notes?: string
}
// Older replies only carried calendar proposals, without a kind.
const kindOf = (proposal: Proposal) => proposal.kind ?? 'event'
const doneOf = (proposal: Proposal) => kindOf(proposal) === 'event' ? proposal.event_id : proposal.ref
const verbs = {
  event: { action: 'Ajouter au planning', done: 'Ajouté au planning', icon: 'calendar' },
  task: { action: 'Créer la tâche', done: 'Tâche créée', icon: 'check' },
  item: { action: 'Ajouter aux courses', done: 'Ajouté aux courses', icon: 'cart' },
  recipe: { action: 'Ajouter au carnet', done: 'Ajoutée au carnet de recettes', icon: 'edit' },
  meal: { action: 'Prévoir ce repas', done: 'Ajouté au menu', icon: 'list' },
  memory: { action: 'Retenir', done: 'Retenu · modifiable dans « Moi »', icon: 'key' },
} as const
type Message = { id: number | string; role: 'user' | 'assistant'; content: string; proposals: Proposal[]; created_at: string }
type Thread = { id: string; title: string; updated_at: string }
type Overview = { enabled: boolean; configured: boolean; remaining: number; threads: Thread[] }

const fresh = (): string => crypto.randomUUID()
// Starting points that use what KARL already gives Hermes; touching one only fills the field.
const suggestions = ['Fais-moi le point sur ma semaine', 'Propose un menu pour la semaine avec nos recettes', 'Qu’est-ce qui manque sur la liste de courses pour le menu ?', 'Aide-moi à organiser mes tâches en retard']
const wide = matchMedia('(min-width: 900px)').matches

// A private thread per member: nobody else in the family, owner included, can open it.
export function Assistant({ ctx }: { ctx: Ctx }) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [thread, setThread] = useState(fresh)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [draft, setDraft] = useState(() => readDraft('assistant'))
  const [problem, setProblem] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const { api } = ctx

  const load = useCallback(async () => {
    try { setOverview(await api('family/assistant')) } catch (e) { setProblem(e instanceof Error ? e.message : 'Assistant indisponible.') }
  }, [api])
  useEffect(() => { void load() }, [load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages, waiting])

  async function open(id: string) {
    setThread(id); setMessages([]); setProblem(''); setLoading(true)
    try { setMessages((await api('family/assistant/threads/' + id)).messages) }
    catch (e) { setProblem(e instanceof Error ? e.message : 'Conversation introuvable.') }
    finally { setLoading(false) }
  }
  function startNew() { setThread(fresh()); setMessages([]); setProblem(''); field.current?.focus() }
  const update = (value: string) => { setDraft(value); writeDraft('assistant', value) }

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || waiting || !ctx.online) return
    const pending: Message = { id: 'pending', role: 'user', content: text, proposals: [], created_at: new Date().toISOString() }
    setMessages(previous => [...previous, pending]); setWaiting(true); setProblem(''); update('')
    try {
      const { message } = await api('family/assistant/chat', { method: 'POST', body: JSON.stringify({ thread_id: thread, message: text }) })
      setMessages(previous => [...previous.filter(item => item.id !== 'pending'), { ...pending, id: 'sent-' + message.id }, message])
      void load()
    } catch (e) {
      // The question goes back into the field so nothing typed is lost.
      setMessages(previous => previous.filter(item => item.id !== 'pending')); update(text)
      setProblem(e instanceof Error ? e.message : 'Message non envoyé.')
    } finally { setWaiting(false) }
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && matchMedia('(hover: hover)').matches) { event.preventDefault(); void send() }
  }
  async function forget(id: string) {
    if (!confirm('Supprimer définitivement cette conversation ?')) return
    if (await ctx.run(async () => { await api('family/assistant/threads/' + id, { method: 'DELETE' }) }, 'Conversation supprimée.')) {
      if (id === thread) startNew()
      void load()
    }
  }
  async function accept(message: Message, index: number) {
    await ctx.run(async () => {
      const { id } = await api(`family/assistant/messages/${message.id}/accept`, { method: 'POST', body: JSON.stringify({ index }) })
      setMessages(previous => previous.map(item => item.id !== message.id ? item
        : { ...item, proposals: item.proposals.map((proposal, at) => at === index ? { ...proposal, [kindOf(proposal) === 'event' ? 'event_id' : 'ref']: id } : proposal) }))
    }, `« ${message.proposals[index].title} » : ${verbs[kindOf(message.proposals[index])].done.toLowerCase()}.`)
  }

  const lede = 'Ton fil privé avec Hermes. Personne d’autre dans la famille ne peut le lire.'
  if (!overview) return <section><ScreenHead title="Hermes" lede={lede} />{problem ? <p className="muted">{problem}</p> : <Skeleton lines={3} />}</section>
  if (!overview.configured || !overview.enabled) return <section>
    <ScreenHead title="Hermes" lede={lede} />
    <Empty title={overview.configured ? 'L’assistant n’est pas activé pour toi.' : 'L’assistant arrive bientôt.'}>
      {overview.configured ? 'Demande à un parent de l’activer dans « Moi ».' : 'Il sera disponible ici dès qu’il sera branché sur le serveur.'}
    </Empty>
  </section>

  const current = overview.threads.find(item => item.id === thread)
  return <section className="assistant">
    <ScreenHead title="Hermes" lede={lede} />
    <div className="assistant-layout">
      <div className="assistant-threads">
        <button className="btn btn-secondary assistant-new" onClick={startNew}><Icon name="plus" />Nouvelle conversation</button>
        {overview.threads.length > 0 && <details className="assistant-threads" open={wide}>
          <summary className="group-title">Mes conversations ({overview.threads.length})<Icon name="chevron" /></summary>
          <ul className="rows">{overview.threads.map(item => <li key={item.id} className="row">
          <button className="thread-pick" aria-current={item.id === thread ? 'true' : undefined} onClick={event => { if (!wide) event.currentTarget.closest('details')?.removeAttribute('open'); void open(item.id) }}>
            <span className="row-title">{item.title}</span>
            <span className="row-meta">{capitalize(longDate(dateKey(new Date(item.updated_at))))}</span>
          </button>
          <button className="icon-btn" aria-label={'Supprimer « ' + item.title + ' »'} disabled={ctx.disabled} onClick={() => void forget(item.id)}><Icon name="trash" /></button>
        </li>)}</ul>
        </details>}
      </div>

      <div className="assistant-chat">
        <h2 className="sr-only">{current ? current.title : 'Nouvelle conversation'}</h2>
        <div className="chat-log" role="log" aria-live="polite" aria-busy={loading || waiting}>
          {!loading && !messages.length && <div className="chips suggestions" role="group" aria-label="Idées de demandes">
            {suggestions.map(text => <button key={text} type="button" className="chip" onClick={() => { update(text); field.current?.focus() }}>{text}</button>)}
          </div>}
          {loading ? <Skeleton lines={3} /> : !messages.length && <Empty title={`Bonjour ${ctx.user.name} !`}>
            Pose une question, demande un coup de main, ou dis par exemple « ajoute piscine mercredi à 17 h », « rappelle-moi d’appeler le dentiste » ou « mets du lait sur la liste ». Rien n’est ajouté ni retenu sans ton accord, et Hermes n’achète, n’envoie et ne supprime jamais rien.
          </Empty>}
          {messages.map(message => <div key={message.id} className={'bubble bubble-' + message.role}>
            <p className="bubble-who">{message.role === 'user' ? 'Toi' : 'Hermes'}</p>
            <p className="bubble-text">{message.content}</p>
            {message.proposals.map((proposal, index) => {
              const kind = kindOf(proposal)
              return <div className="proposal" key={index}>
                <p className="proposal-title"><Icon name={verbs[kind].icon} />{kind === 'memory' ? 'À retenir : ' : ''}{proposal.title}</p>
                {kind === 'event' && proposal.starts_at && proposal.ends_at && <>
                  <p className="row-meta"><span>{capitalize(longDate(dateKey(new Date(proposal.starts_at))))} · {clock(proposal.starts_at)}–{clock(proposal.ends_at)}</span>
                    {proposal.location && <span><Icon name="pin" />{proposal.location}</span>}</p>
                  <p className="thread-meta">{(proposal.attendees ?? []).map(id => <Person key={id} member={ctx.find(id)} fallback="Ancien membre" />)}</p>
                </>}
                {kind === 'task' && <p className="row-meta"><Person member={ctx.find(proposal.assignee_id ?? null)} />{proposal.due_date && <span>Pour le {longDate(proposal.due_date)}</span>}{proposal.repeat === 'weekly' && <span><Icon name="refresh" />Chaque semaine</span>}</p>}
                {kind === 'meal' && proposal.day && <p className="row-meta"><span>{capitalize(longDate(proposal.day))} · {proposal.slot === 'lunch' ? 'midi' : 'soir'}</span><span>{plural(proposal.servings ?? 4, 'personne')}</span></p>}
                {kind === 'recipe' && <>
                  <p className="row-meta"><span>{plural(proposal.servings ?? 4, 'personne')}</span><span>{plural(proposal.ingredients?.length ?? 0, 'ingrédient')}</span></p>
                  <details><summary className="btn-quiet">Voir les ingrédients</summary><ul className="proposal-list">{(proposal.ingredients ?? []).map((line, at) => <li key={at}>{line}</li>)}</ul>
                    {proposal.notes && <p className="bubble-text">{proposal.notes}</p>}</details>
                </>}
                {kind === 'item' && <p className="row-meta">{proposal.quantity && <strong>{proposal.quantity}</strong>}<span>{proposal.category}</span></p>}
                {doneOf(proposal) ? <p className="proposal-done"><Icon name="check" />{verbs[kind].done}</p>
                  : <button className="btn btn-gold" disabled={ctx.disabled || typeof message.id !== 'number'} onClick={() => void accept(message, index)}><Icon name="plus" />{verbs[kind].action}</button>}
              </div>
            })}
          </div>)}
          {waiting && <p className="bubble bubble-assistant bubble-wait"><span className="bubble-who">Hermes</span>Hermes réfléchit…</p>}
          <div ref={end} />
        </div>
        {problem && <p className="banner banner-error" role="alert"><Icon name="alert" /><span>{problem}</span></p>}
        <form className="chat-compose" onSubmit={send}>
          <label htmlFor="assistant-message" className="sr-only">Ton message à Hermes</label>
          <textarea id="assistant-message" ref={field} rows={2} maxLength={4000} value={draft} onChange={event => update(event.target.value)} onKeyDown={onKey}
            placeholder="Écris à Hermes…" disabled={!ctx.online} enterKeyHint="send" />
          <button className="btn btn-primary" disabled={!draft.trim() || waiting || !ctx.online || overview.remaining <= 0}><Icon name="arrow" />Envoyer</button>
        </form>
        <p className="muted chat-quota"><button className="btn-quiet" onClick={() => ctx.go('me')}>Ce que Hermes retient de toi et ce qu’il peut faire<Icon name="chevron" /></button></p>
        <p className="muted chat-quota">{overview.remaining > 0 ? `${plural(overview.remaining, 'message')} ${overview.remaining > 1 ? 'restants' : 'restant'} aujourd’hui.` : 'Limite du jour atteinte. Hermes revient demain.'}</p>
      </div>
    </div>
  </section>
}
