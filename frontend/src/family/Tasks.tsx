import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import { readDraft, writeDraft } from './api'
import type { Ctx } from './context'
import type { Task } from './model'
import { clock, dateKey, due, plural, shortDate, timeKey } from './model'
import { Badge, Empty, Person, ScreenHead, Sheet, Skeleton, useOptimistic } from './ui'

export function TaskRow({ ctx, task }: { ctx: Ctx; task: Task }) {
  const [editing, setEditing] = useState(false)
  const parent = ctx.user.role === 'admin'
  const waiting = !!task.key_task && !task.done && !!task.submitted_by
  const [done, setDone] = useOptimistic(!!task.done || waiting, value => ctx.run(async () => {
    await ctx.api('family/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ version: task.version, done: value }) })
  }, task.key_task && !parent && value ? 'Bravo ! Un parent va vérifier puis valider.' : ''))
  const review = (decision: 'approve' | 'reject') => void ctx.run(async () => {
    await ctx.api('family/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ version: task.version, review: decision }) })
  }, decision === 'approve' ? `« ${task.title} » validée.` : `« ${task.title} » renvoyée à faire.`)
  const deadline = done ? null : due(task.due_date, ctx.today)
  // A validated key task is locked for members: only a parent can reopen it.
  const locked = !!task.key_task && !!task.done && !parent
  return <li className={`row ${task.done ? 'is-done' : ''} ${waiting ? 'is-waiting' : ''}`}>
    <label className="row-main">
      <input type="checkbox" className="check" checked={done} disabled={ctx.disabled || locked} onChange={event => setDone(event.target.checked)} />
      <span className="row-text">
        <span className="row-title">{task.title}{task.done ? <span className="sr-only"> (fait)</span> : waiting ? <span className="sr-only"> (à valider)</span> : null}</span>
        <span className="row-meta">
          {!!task.key_task && <span className="tag tag-key"><Icon name="key" />Tâche clé</span>}
          {task.repeat === 'weekly' && <span className="tag"><Icon name="refresh" />Chaque semaine</span>}
          {task.remind_at && !task.done && <span className="due"><Icon name="clock" />Rappel {dateKey(new Date(task.remind_at)) !== task.due_date ? shortDate(dateKey(new Date(task.remind_at))) + ' ' : ''}{clock(task.remind_at)}</span>}
          <Person member={ctx.find(task.assignee_id)} />
          {deadline && !waiting && <span className={deadline.late ? 'due due-late' : 'due'}>{deadline.late && <Icon name="alert" />}{deadline.label}</span>}
          {waiting && <span className="tag tag-strong"><Icon name="clock" />Faite par {ctx.find(task.submitted_by)?.name ?? 'un membre'} · à valider</span>}
          {!!task.key_task && !!task.done && task.validated_by && <span>Validée par {ctx.find(task.validated_by)?.name ?? 'un parent'}</span>}
        </span>
      </span>
    </label>
    {waiting && parent && <span className="review-actions">
      <button className="btn btn-gold btn-small" disabled={ctx.disabled} onClick={() => review('approve')}><Icon name="check" />Valider<span className="sr-only"> « {task.title} »</span></button>
      <button className="btn btn-secondary btn-small" disabled={ctx.disabled} onClick={() => review('reject')}><Icon name="refresh" />À refaire<span className="sr-only"> : « {task.title} »</span></button>
    </span>}
    {ctx.canManage(task.created_by) && !task.done && <button className="icon-btn" aria-label={'Modifier ' + task.title} disabled={ctx.disabled} onClick={() => setEditing(true)}><Icon name="edit" /></button>}
    {editing && <Sheet open title="Modifier la tâche" onClose={() => setEditing(false)}><TaskForm ctx={ctx} task={task} onDone={() => setEditing(false)} /></Sheet>}
    {ctx.canManage(task.created_by) && <button className="icon-btn" aria-label={'Retirer ' + task.title} disabled={ctx.disabled} onClick={() => ctx.remove('tasks/' + task.id, task.version, task.title)}><Icon name="trash" /></button>}
  </li>
}

export function Tasks({ ctx }: { ctx: Ctx }) {
  const [title, setTitle] = useState(() => readDraft('task'))
  const [assignee, setAssignee] = useState(ctx.user.id)
  const [date, setDate] = useState('')
  const [key, setKey] = useState(false)
  const [weekly, setWeekly] = useState(false)
  const [remind, setRemind] = useState('')
  const parent = ctx.user.role === 'admin'
  const tasks = ctx.data?.tasks ?? []
  const open = tasks.filter(task => !task.done)
  const done = tasks.filter(task => task.done)
  const groups = [
    ...(parent ? [{ key: 'review', title: 'À valider', rows: open.filter(task => task.key_task && task.submitted_by) }] : []),
    { key: 'me', title: 'Pour toi', rows: open.filter(task => task.assignee_id === ctx.user.id && !(parent && task.key_task && task.submitted_by)) },
    { key: 'all', title: 'Pour toute la famille', rows: open.filter(task => !task.assignee_id && !(parent && task.key_task && task.submitted_by)) },
    ...ctx.members.filter(member => member.id !== ctx.user.id).map(member => ({ key: member.id, title: 'Pour ' + member.name, rows: open.filter(task => task.assignee_id === member.id && !(parent && task.key_task && task.submitted_by)) })),
    // Tasks left to someone whose access was switched off stay visible so they can be given to someone else.
    { key: 'gone', title: 'Pour un membre sans accès', rows: open.filter(task => task.assignee_id && task.assignee_id !== ctx.user.id && !ctx.members.some(member => member.id === task.assignee_id)) },
  ].filter(group => group.rows.length)
  const update = (value: string) => { setTitle(value); writeDraft('task', value) }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (await ctx.run(async () => {
      await ctx.api('family/tasks', { method: 'POST', body: JSON.stringify({ title, assignee_id: assignee || null, due_date: date || null, key_task: parent && key, repeat: weekly ? 'weekly' : 'none', remind_at: date && remind ? new Date(`${date}T${remind}`).toISOString() : null }) })
    }, parent && key ? 'Tâche clé ajoutée : tu valideras quand elle sera faite.' : '')) { update(''); setDate(''); setKey(false); setWeekly(false); setRemind('') }
  }

  return <section>
    <ScreenHead title="Tâches" lede={ctx.data ? `${plural(open.length, 'tâche')} à faire, réparties dans la famille.` : 'Chargement…'} />
    <form className="compose" onSubmit={add}>
      <div className="field"><label htmlFor="task-title">Nouvelle tâche</label>
        <input id="task-title" value={title} onChange={event => update(event.target.value)} required maxLength={160} placeholder="Préparer le sac de sport…" /></div>
      <fieldset className="chips"><legend>Pour qui ?</legend>
        <label className="chip"><input type="radio" name="assignee" value="" checked={assignee === ''} onChange={() => setAssignee('')} /><span className="badge-all" aria-hidden="true" />Tous</label>
        {ctx.members.map(member => <label className="chip" key={member.id}><input type="radio" name="assignee" value={member.id} checked={assignee === member.id} onChange={() => setAssignee(member.id)} /><Badge member={member} size={22} />{member.name}</label>)}
      </fieldset>
      {parent && <label className="key-toggle"><input type="checkbox" className="check" checked={key} onChange={event => setKey(event.target.checked)} />
        <span><strong><Icon name="key" />Tâche clé</strong><span className="muted">Quand elle est cochée, un parent vérifie puis valide qu’elle est bien faite.</span></span></label>}
      <label className="key-toggle"><input type="checkbox" className="check" checked={weekly} onChange={event => setWeekly(event.target.checked)} />
        <span><strong><Icon name="refresh" />Chaque semaine</strong><span className="muted">Une fois faite, la tâche revient automatiquement la semaine suivante.</span></span></label>
      <div className="compose-row">
        <div className="field"><label htmlFor="task-date">Pour quand ? <span className="optional">{weekly ? 'première fois' : 'facultatif'}</span></label><input id="task-date" type="date" value={date} required={weekly} onChange={event => setDate(event.target.value)} /></div>
        <div className="field field-time"><label htmlFor="task-remind">Rappel <span className="optional">heure</span></label><input id="task-remind" type="time" value={remind} disabled={!date} onChange={event => setRemind(event.target.value)} aria-describedby="task-remind-help" /></div>
        <button className="btn btn-gold" disabled={ctx.disabled || !title.trim()}><Icon name="plus" />Ajouter</button>
      </div>
      <p id="task-remind-help" className="muted">Le rappel s’affiche sur l’Accueil à l’heure dite, et en notification si KARL est ouvert. Choisissez d’abord une date.</p>
    </form>
    {!ctx.data ? <Skeleton /> : !open.length && <Empty title="Tout est fait. Bravo !" />}
    {groups.map(group => <section className="group" key={group.key} aria-labelledby={'tasks-' + group.key}>
      <h2 className="group-title" id={'tasks-' + group.key}>{group.title}<span>{group.rows.length}</span></h2>
      <ul className="rows">{group.rows.map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul>
    </section>)}
    {done.length > 0 && <details className="group done-group"><summary className="group-title">Fait<span>{done.length}</span></summary>
      <ul className="rows">{done.map(task => <TaskRow ctx={ctx} task={task} key={task.id} />)}</ul></details>}
  </section>
}

function TaskForm({ ctx, task, onDone }: { ctx: Ctx; task: Task; onDone: () => void }) {
  const [assignee, setAssignee] = useState(task.assignee_id && ctx.members.some(member => member.id === task.assignee_id) ? task.assignee_id : '')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    // The reminder is a local date and time of its own: it may fall the day before the due date, or have no due date.
    const day = String(form.get('due') || ''), at = String(form.get('remind') || '')
    if (await ctx.run(async () => {
      await ctx.api('family/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ version: task.version, title: form.get('title'), assignee_id: assignee || null, due_date: day || null,
        remind_at: at ? new Date(at).toISOString() : null }) })
    }, 'Tâche modifiée.')) onDone()
  }
  return <form className="sheet-body" onSubmit={save}>
    <div className="field"><label htmlFor="edit-task-title">Tâche</label><input id="edit-task-title" name="title" required maxLength={160} defaultValue={task.title} /></div>
    <fieldset className="chips"><legend>Pour qui ?</legend>
      <label className="chip"><input type="radio" name="edit-assignee" checked={assignee === ''} onChange={() => setAssignee('')} /><span className="badge-all" aria-hidden="true" />Tous</label>
      {ctx.members.map(member => <label className="chip" key={member.id}><input type="radio" name="edit-assignee" checked={assignee === member.id} onChange={() => setAssignee(member.id)} /><Badge member={member} size={22} />{member.name}</label>)}
    </fieldset>
    <div className="field"><label htmlFor="edit-task-due">Pour quand ? <span className="optional">{task.repeat === 'weekly' ? 'obligatoire, chaque semaine' : 'facultatif'}</span></label>
      <input id="edit-task-due" name="due" type="date" defaultValue={task.due_date ?? ''} required={task.repeat === 'weekly'} /></div>
    <div className="field"><label htmlFor="edit-task-remind">Rappel <span className="optional">jour et heure, facultatif</span></label>
      <input id="edit-task-remind" name="remind" type="datetime-local" defaultValue={task.remind_at ? `${dateKey(new Date(task.remind_at))}T${timeKey(new Date(task.remind_at))}` : ''} /></div>
    <div className="sheet-actions"><span /><button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Enregistrer</button></div>
  </form>
}
