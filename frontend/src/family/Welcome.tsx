import { Icon } from '../icons'
import { Logo } from './Logo'

export function Welcome({ invitation, googleEnabled, busy, online, onAccept, onPersonal }: {
  invitation: boolean; googleEnabled: boolean; busy: boolean; online: boolean; onAccept: () => void; onPersonal: () => void
}) {
  return <main className="welcome" id="main">
    <Logo size={72} />
    <h1>Le carnet de la famille.</h1>
    <p className="lede">Un seul endroit pour savoir qui fait quoi aujourd’hui.</p>
    <ul className="reasons">
      <li><Icon name="calendar" /><span><strong>Le planning</strong>Les activités de chacun et qui accompagne.</span></li>
      <li><Icon name="cart" /><span><strong>Les courses</strong>Une liste commune, cochée en direct au magasin.</span></li>
      <li><Icon name="check" /><span><strong>Les tâches</strong>Les coups de main, attribués à quelqu’un.</span></li>
    </ul>
    {invitation ? <section className="welcome-action" aria-labelledby="invite-title">
      <h2 id="invite-title">Une place t’attend.</h2>
      <p className="muted">Ce lien personnel ouvre ton compte familial sur cet appareil, pour 30 jours.</p>
      <button className="btn btn-gold btn-wide" disabled={busy || !online} onClick={onAccept}>{busy ? 'Ouverture…' : 'Accepter mon invitation'}<Icon name="chevron" /></button>
    </section> : <section className="welcome-action">
      {googleEnabled && <a className="btn btn-primary btn-wide" href="/api/auth/google/start">Continuer avec Google<Icon name="chevron" /></a>}
      <p className="muted">Pour rejoindre la famille, ouvre le lien d’invitation qu’un parent t’a transmis.</p>
    </section>}
    <button className="btn-quiet" onClick={onPersonal}>Je gère KARL : ouvrir mon espace personnel<Icon name="chevron" /></button>
  </main>
}
