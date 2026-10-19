import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Icon } from '../icons'
import type { Ctx } from './context'
import { Badge, badgeOf, ScreenHead } from './ui'

type InstallPrompt = Event & { prompt: () => Promise<void> }
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function Me({ ctx, googleEnabled, installPrompt, onPersonal, onSignOut, onProfile }: {
  ctx: Ctx; googleEnabled: boolean; installPrompt: InstallPrompt | null
  onPersonal: () => void; onSignOut: () => void; onProfile: () => Promise<void>
}) {
  const { user } = ctx
  const [invitation, setInvitation] = useState('')
  const link = useRef<HTMLInputElement>(null)
  const me = ctx.data?.members.find(member => member.id === user.id)

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget), target = event.currentTarget
    await ctx.run(async () => {
      const result = await ctx.api('family/invitations', { method: 'POST', body: JSON.stringify({ name: form.get('name'), email: form.get('email'), role: form.get('role') }) })
      setInvitation(result.url); target.reset()
    }, 'Invitation créée. Transmettez ce lien en privé à la personne concernée.')
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await ctx.run(async () => {
      await ctx.api('family/profile', { method: 'PATCH', body: JSON.stringify({ name: form.get('name'), email: form.get('email') }) })
      await onProfile()
    }, 'Profil enregistré.')
  }

  return <section>
    <ScreenHead title="Moi" />
    <div className="profile">
      <Badge member={user} size={56} />
      <div><p className="profile-name">{user.name}</p><p className="muted">{user.is_owner ? 'Propriétaire · administrateur' : user.role === 'admin' ? 'Administrateur' : 'Membre'} · ton symbole : {badgeOf(user).name}</p></div>
    </div>

    <section className="group" aria-labelledby="family-title">
      <h2 className="group-title" id="family-title">La famille<span>{ctx.members.length}</span></h2>
      <ul className="rows">{(ctx.data?.members ?? []).map(member => <li className={`row ${member.active ? '' : 'is-inactive'}`} key={member.id}>
        <span className="row-main"><Badge member={member} size={32} /><span className="row-text"><span className="row-title">{member.name}{member.id === user.id ? ' (toi)' : ''}</span>
          <span className="row-meta">{member.role === 'admin' ? 'Administrateur' : 'Membre'}{!member.active && <strong>Accès désactivé</strong>}{member.email && <span>{member.email}</span>}</span></span></span>
        {user.role === 'admin' && !member.is_owner && member.id !== user.id && <button className="btn btn-secondary btn-small" disabled={ctx.disabled}
          onClick={() => void ctx.run(async () => { await ctx.api('family/members/' + member.id, { method: 'PATCH', body: JSON.stringify({ active: !member.active }) }) },
            member.active ? `Accès de ${member.name} désactivé sur tous ses appareils.` : `Accès de ${member.name} réactivé. Créez une nouvelle invitation.`)}>
          {member.active ? 'Désactiver' : 'Réactiver'}</button>}
      </li>)}</ul>
    </section>

    {user.role === 'admin' && <section className="group" aria-labelledby="invite-title">
      <h2 className="group-title" id="invite-title">Inviter un proche</h2>
      <form className="compose" onSubmit={invite}>
        <div className="compose-row">
          <div className="field"><label htmlFor="invite-name">Prénom</label><input id="invite-name" name="name" required maxLength={60} /></div>
          <div className="field"><label htmlFor="invite-email">Adresse e-mail</label><input id="invite-email" name="email" type="email" required autoComplete="off" /></div>
        </div>
        <div className="field"><label htmlFor="invite-role">Accès</label><select id="invite-role" name="role"><option value="member">Membre · planning, courses et tâches</option><option value="admin">Administrateur · gère aussi la famille</option></select></div>
        <button className="btn btn-gold" disabled={ctx.disabled}><Icon name="plus" />Créer le lien d’invitation</button>
      </form>
      {invitation && <div className="invitation">
        <label htmlFor="invitation-link">Lien privé, valable 7 jours, utilisable une fois</label>
        <input ref={link} id="invitation-link" readOnly value={invitation} onFocus={event => event.target.select()} />
        <button className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(invitation).then(() => ctx.notify('Lien copié.'), () => { link.current?.select(); ctx.notify('Sélectionnez le lien puis copiez-le.') })}><Icon name="copy" />Copier le lien</button>
        <p className="muted">À ouvrir dans Safari sur le téléphone de la personne. Un nouveau lien pour la même adresse remplace l’ancien.</p>
      </div>}
      <p className="muted">{googleEnabled ? 'Les adresses invitées peuvent aussi utiliser « Continuer avec Google ».' : 'La connexion Google n’est pas activée : les liens d’invitation suffisent.'}</p>
    </section>}

    {user.is_owner && <details className="group">
      <summary className="group-title">Mon prénom et mon adresse</summary>
      <form className="compose" onSubmit={saveProfile}>
        <div className="field"><label htmlFor="profile-name">Prénom</label><input id="profile-name" name="name" defaultValue={user.name} required maxLength={60} /></div>
        <div className="field"><label htmlFor="profile-email">Adresse Google</label><input id="profile-email" name="email" type="email" autoComplete="email" defaultValue={me?.email ?? ''} required /></div>
        <button className="btn btn-primary" disabled={ctx.disabled}><Icon name="check" />Enregistrer</button>
      </form>
    </details>}

    <section className="group" aria-labelledby="install-title" id="install">
      <h2 className="group-title" id="install-title">Installer KARL</h2>
      {installPrompt ? <button className="btn btn-secondary" onClick={() => void installPrompt.prompt()}><Icon name="share" />Ajouter à l’écran d’accueil</button>
        : ios ? <ol className="steps"><li>Ouvrez KARL dans <strong>Safari</strong>.</li><li>Touchez <strong>Partager</strong> <Icon name="share" />.</li><li>Choisissez <strong>Sur l’écran d’accueil</strong>.</li></ol>
          : <p className="muted">Dans le menu du navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».</p>}
      <p className="muted">Hors connexion, KARL affiche les dernières données chargées, en lecture seule.</p>
    </section>

    <div className="me-actions">
      {user.is_owner && <button className="btn btn-secondary" onClick={onPersonal}><Icon name="chat" />Assistant personnel</button>}
      <button className="btn btn-secondary" disabled={ctx.disabled} onClick={onSignOut}><Icon name="logout" />Se déconnecter</button>
    </div>
    <p className="footnote">L’espace famille partage uniquement le planning, les courses et les tâches. L’assistant personnel reste privé.</p>
  </section>
}
