import { lazy, Suspense, useState } from 'react'
import FamilyApp from './family/FamilyApp'

// The personal assistant (and its stylesheet) only loads for the owner who opens it.
const PersonalApp = lazy(() => import('./App'))

export default function Root() {
  const [personal, setPersonal] = useState(false)
  return personal
    ? <Suspense fallback={<p role="status" style={{ padding: 24 }}>Ouverture de l’espace personnel…</p>}><PersonalApp onFamily={() => setPersonal(false)} /></Suspense>
    : <FamilyApp onPersonal={() => setPersonal(true)} />
}
