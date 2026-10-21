import type { FamilyEvent, Member, Snapshot, User, View } from './model'

export type Ctx = {
  user: User
  data: Snapshot | null
  members: Member[]
  today: string
  now: Date
  online: boolean
  disabled: boolean
  find: (id: string | null) => Member | undefined
  api: (path: string, options?: RequestInit) => Promise<any>
  run: (job: () => Promise<void>, notice?: string) => Promise<boolean>
  notify: (message: string) => void
  remove: (path: string, version: number, label: string) => void
  go: (view: View) => void
  editEvent: (event: FamilyEvent | null, day?: string) => void
  canManage: (createdBy: string) => boolean
}
