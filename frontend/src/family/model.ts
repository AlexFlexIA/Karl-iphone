export type User = { id: string; name: string; role: 'admin' | 'member'; is_owner: boolean; badge: number | null }
export type Member = User & { active: boolean; email?: string | null }
export type Session = { user: User | null; csrf: string | null; google_enabled: boolean; preview: boolean }
export type Item = { id: string; name: string; quantity: string; category: string; checked: number; version: number; author: string }
export type Task = { id: string; title: string; assignee_id: string | null; due_date: string | null; done: number; created_by: string; version: number }
export type FamilyEvent = {
  id: string; title: string; starts_at: string; ends_at: string; series_starts_at: string; series_ends_at: string
  attendees: string[]; driver_id: string | null; location: string; recurrence: 'once' | 'weekly'; created_by: string; version: number
}
export type Snapshot = { members: Member[]; items: Item[]; tasks: Task[]; events: FamilyEvent[]; at: Date }
export type View = 'today' | 'planning' | 'shopping' | 'tasks' | 'me'

export const categories = ['Fruits et légumes', 'Frais', 'Épicerie', 'Maison', 'Autres'] as const

export const plural = (count: number, word: string, many = word + 's') => `${count} ${count > 1 ? many : word}`
export const pad = (value: number) => String(value).padStart(2, '0')
export const dateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
export const timeKey = (value: Date) => `${pad(value.getHours())}:${pad(value.getMinutes())}`
export const clock = (value: string) => timeKey(new Date(value))
export const fromKey = (key: string) => new Date(key + 'T12:00:00')
export function addDays(value: Date, days: number) {
  const result = new Date(value); result.setDate(result.getDate() + days)
  return result
}
export function monday(value: Date) {
  const result = new Date(value); result.setDate(result.getDate() - (result.getDay() + 6) % 7); result.setHours(12, 0, 0, 0)
  return result
}
export const longDate = (key: string) => fromKey(key).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
export const shortDate = (key: string) => fromKey(key).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function due(date: string | null, today: string): { label: string; late: boolean } | null {
  if (!date) return null
  if (date < today) return { label: 'En retard · ' + shortDate(date), late: true }
  if (date === today) return { label: 'Aujourd’hui', late: false }
  if (date === dateKey(addDays(fromKey(today), 1))) return { label: 'Demain', late: false }
  return { label: shortDate(date), late: false }
}

export const eventDay = (event: FamilyEvent) => dateKey(new Date(event.starts_at))
