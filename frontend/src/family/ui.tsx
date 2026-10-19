import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons'
import type { Member } from './model'

// Six slots, each a distinct shape AND a fill that differs in lightness from its
// neighbours: people stay distinguishable in greyscale and with any colour vision.
const badges = [
  { shape: 'circle', fill: '#2458FF', ink: '#FFFFFF', name: 'rond' },
  { shape: 'square', fill: '#65DEFF', ink: '#061426', name: 'carré' },
  { shape: 'triangle', fill: '#006C8F', ink: '#FFFFFF', name: 'triangle' },
  { shape: 'diamond', fill: '#AEBFFF', ink: '#061426', name: 'losange' },
  { shape: 'hexagon', fill: '#1B3A8A', ink: '#FFFFFF', name: 'hexagone' },
  { shape: 'pentagon', fill: '#D6F4FF', ink: '#061426', name: 'pentagone' },
] as const

export const badgeOf = (member: Pick<Member, 'badge'> | null | undefined) => badges[(member?.badge ?? 0) % badges.length]

export function Badge({ member, size = 28, label }: { member: Pick<Member, 'name' | 'badge'> | null | undefined; size?: number; label?: boolean }) {
  const style = badgeOf(member)
  const letter = (member?.name ?? '?').trim().charAt(0).toUpperCase()
  const paint = { fill: style.fill, stroke: 'var(--ink)', strokeWidth: 1.5 }
  const shape = {
    circle: <circle cx="14" cy="14" r="12.5" {...paint} />,
    square: <rect x="1.75" y="1.75" width="24.5" height="24.5" rx="5" {...paint} />,
    triangle: <polygon points="14,1.5 26.5,25.5 1.5,25.5" {...paint} />,
    diamond: <polygon points="14,1 27,14 14,27 1,14" {...paint} />,
    hexagon: <polygon points="7.5,2 20.5,2 27,14 20.5,26 7.5,26 1,14" {...paint} />,
    pentagon: <polygon points="14,1.5 26.5,10.5 22,26 6,26 1.5,10.5" {...paint} />,
  }[style.shape]
  const y = style.shape === 'triangle' ? 21.5 : 18.6
  return <svg className="badge" width={size} height={size} viewBox="0 0 28 28" {...(label ? { role: 'img', 'aria-label': member?.name ?? 'Membre' } : { 'aria-hidden': true })}>
    {shape}<text x="14" y={y} textAnchor="middle" fontSize={style.shape === 'triangle' ? 10.5 : 12.5} fontWeight="700" fill={style.ink} fontFamily="inherit">{letter}</text>
  </svg>
}

export function Person({ member, fallback = 'Toute la famille' }: { member: Member | null | undefined; fallback?: string }) {
  return <span className="person">{member ? <Badge member={member} size={22} /> : <span className="badge-all" aria-hidden="true" />}{member?.name ?? fallback}</span>
}

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) {
      node.showModal()
      // Start on the first field rather than the close button.
      node.querySelector<HTMLElement>('.sheet-body input, .sheet-body select')?.focus()
    }
    if (!open && node.open) node.close()
  }, [open])
  return <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title" onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose() }}>
    {open && <div className="sheet-inner">
      <header className="sheet-head"><h2 id="sheet-title">{title}</h2><button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" /></button></header>
      {children}
    </div>}
  </dialog>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><p className="empty-title">{title}</p>{children}</div>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton" aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${88 - index * 17}%` }} />)}</div>
}

export function ScreenHead({ eyebrow, title, lede, action }: { eyebrow?: string; title: string; lede?: ReactNode; action?: ReactNode }) {
  return <header className="screen-head">
    <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{lede && <p className="lede">{lede}</p>}</div>
    {action}
  </header>
}

// Ticks respond instantly; the server answer (or a refused write) then replaces the guess.
export function useOptimistic(server: boolean, send: (value: boolean) => Promise<boolean>) {
  const [local, setLocal] = useState<boolean | null>(null)
  return [local ?? server, (value: boolean) => { setLocal(value); void send(value).finally(() => setLocal(null)) }] as const
}
