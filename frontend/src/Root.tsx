import { useState } from 'react'
import PersonalApp from './App'
import FamilyApp from './FamilyApp'

export default function Root() {
  const [personal, setPersonal] = useState(false)
  return personal ? <PersonalApp onFamily={() => setPersonal(false)} /> : <FamilyApp onPersonal={() => setPersonal(true)} />
}
