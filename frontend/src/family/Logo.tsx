// KARL lighthouse mark: the tower is the K's stem, the beam its upper arm, with a Breton ermine.
// Drawn once here; public/icon.svg and the PNG icons are rendered from the same geometry.
export const markPaths = <>
  <polygon points="40,23 92,13 92,35 40,27" fill="#ECC14E" />
  <polygon points="40,58 64,30 77,30 48,66" fill="#E3B026" />
  <polygon points="42,50 52,44 87,92 71,92" fill="#E3B026" />
  <polygon points="29,32 43,32 47,92 25,92" fill="#1E429F" />
  <polygon points="36,32 43,32 47,92 36,92" fill="#2A55C4" />
  <rect x="26" y="29" width="20" height="4" rx="1" fill="#1E429F" />
  <rect x="30" y="17" width="12" height="12" fill="#1E429F" />
  <rect x="32.5" y="19.5" width="7" height="7" fill="#E3B026" />
  <polygon points="28,17.5 36,10 44,17.5" fill="#1E429F" />
  <rect x="35.2" y="6" width="1.6" height="5" fill="#1E429F" />
  <g fill="#1E429F">
    <path d="M57 74c-1.2 3-2.6 6.4-4.4 9.4l2.6-1.2 1.8 3 1.8-3 2.6 1.2c-1.8-3-3.2-6.4-4.4-9.4z" />
    <circle cx="57" cy="72" r="1.5" /><circle cx="54" cy="74.2" r="1.3" /><circle cx="60" cy="74.2" r="1.3" />
  </g>
</>

export function LogoMark({ size = 40, label }: { size?: number; label?: string }) {
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 100 100" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>{markPaths}</svg>
}

export function Logo({ size = 40, caption }: { size?: number; caption?: string }) {
  return <span className="logo"><LogoMark size={size} /><span className="logo-word">KARL</span>{caption && <span className="logo-caption">{caption}</span>}</span>
}
