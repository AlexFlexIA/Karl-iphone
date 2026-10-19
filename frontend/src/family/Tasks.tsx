import { useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import { readDraft, writeDraft } from './api'
import type { Ctx } from './context'
import type { Task } from './model'
import { due, plural } from './model'
import { Badge, Empty, Person, ScreenHead, Skeleton, useOptimistic } from './ui'

export function TaskRow({ ctx, task }: { ctx: Ctx; task: Task }) {
  const [done, setDone] = useOptimistic(!!task.done, value => ctx.run(async () => {
    await ctx.api('family/tasks/' + task.id, { method: 'PATCH', body: JSON.stringify({ version: task.version, done: value }) })
  }))
  const deadline = done ? null : due(task.due_date, ctx.today)
  return <li className={`row ${done ? 'is-done' : ''}`}>
    <label className="row-main">
      <input type="checkbox" className="check" checked={done} disabled={ctx.disabled} onChange={event => setDone(event.target.checked)} />
      <span className="row-text">
        <span className="row-title">{task.title}{done ? <span className="sr-only"> (fait)</span> : null}</span>
        <span className="row-meta">
          <Person member={ctx.find(task.assignee_id)} />
          {deadline && <span className={deadline.late ? 'due due-late' : 'due'}>{deadline.late && <Icon name="alert" />}{deadline.label}</span>}
        </span>
      </span>
    </label>
    {ctx.canManage(task.created_by) && <button className="icon-btn" aria-label={'Retirer ' + task.title} disabled={ctx.disabled} onClick={() => ctx.remove('tasks/' + task.id, task.version, task.title)}><Icon name="trash" /></button>}
  </li>
}

export function Tasks({ ctx }: { ctx: Ctx }) {
  const [title, setTitle] = useState(() => readDraft('task'))
  const [assignee, setAssignee] = useState(ctx.user.id)
  const [date, setDate] = useState('')
  const tasks = ctx.data?.tasks ?? []
  const open = tasks.filter(task => !task.done)
  const done = tasks.filter(task => task.done)
  const groups = [
    { key: 'me', title: 'Pour toi', rows: open.filter(task => task.assignee_id === ctx.user.id) },
    { key: 'all', title: 'Pour toute la famille', rows: open.filter(task => !task.assignee_id) },
    ...ctx.members.filter(member => member.id !== ctx.user.id).map(member => ({ key: member.id, title: 'Pour ' + member.name, rows: open.filter(task => task.assignee_id === member.id) })),
  ].filter(group => group.rows.length)
  const update = (value: string) => { setTitle(value); writeDraft('task', value) }

  async function add(event: FormEvent) {
    event.preventDefault()
    if (await ctx.run(async () => {
      await ctx.api('family/tasks', { method: 'POST', body: JSON.stringify({ title, assignee_id: assignee || null, due_date: date || null }) })
    })) { update(''); setDate('') }
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
      <div className="compose-row">
        <div className="field"><label htmlFor="task-date">Pour quand ? <span className="optional">facultatif</span></label><input id="task-date" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
        <button className="btn btn-primary" disabled={ctx.disabled || !title.trim()}><Icon name="plus" />Ajouter</button>
      </div>
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
