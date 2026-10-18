import type { ReactNode } from 'react'
const shapes: Record<string, ReactNode> = {
  chat: <path d="M20 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 18 0Z" />,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 20V4m-7 7 7-7 7 7" />,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4m-4 0h8" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  sound: <><path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  logout: <><path d="M9 4H3v16h6m0-8h12m-4-4 4 4-4 4" /></>,
  refresh: <><path d="M3 10a9 9 0 0 1 16-5l2 3M21 3v5h-5M21 14a9 9 0 0 1-16 5l-2-3M3 21v-5h5" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m4 12 5 5L20 6" />,
  offline: <><path d="m3 3 18 18M2 9a18 18 0 0 1 4-2m3-2a18 18 0 0 1 13 4M6 13a10 10 0 0 1 4-2m5 1 3 1M10 17a4 4 0 0 1 4 0M12 21h.01" /></>,
}
export function Icon({ name, className = '' }: { name: keyof typeof shapes; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>
}
