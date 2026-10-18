import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}
const voiceWindow = window as VoiceWindow
const RecognitionClass = voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition

export function useVoice(draft: string, setDraft: Dispatch<SetStateAction<string>>, onError: (error: string) => void) {
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const recognition = useRef<Recognition | null>(null)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const canDictate = Boolean(RecognitionClass && window.isSecureContext)
  const canSpeak = 'speechSynthesis' in window

  function stopMedia() {
    const current = recognition.current
    recognition.current = null
    if (current) { current.onresult = null; current.onend = null; current.onerror = null; current.abort() }
    setListening(false)
    utterance.current = null
    if (canSpeak) speechSynthesis.cancel()
    setSpeaking(null)
  }

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stopMedia() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility); stopMedia() }
  }, [])

  function toggleDictation() {
    if (listening) { recognition.current?.stop(); return }
    if (!RecognitionClass || !canDictate) return
    stopMedia()
    const before = draft.trim()
    const current = new RecognitionClass()
    recognition.current = current
    current.lang = 'fr-FR'
    current.continuous = false
    current.interimResults = true
    current.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ')
      setDraft([before, transcript].filter(Boolean).join(' ').slice(0, 4000))
    }
    current.onerror = event => {
      setListening(false)
      if (event.error === 'aborted') return
      onError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Micro refusé. Autorisez-le dans le navigateur ou utilisez le clavier.'
        : event.error === 'no-speech' ? 'Aucune parole détectée. Relancez la dictée ou écrivez votre message.'
          : 'Dictée indisponible. Utilisez le micro du clavier iPhone ou écrivez votre message.')
    }
    current.onend = () => { if (recognition.current === current) { setListening(false); recognition.current = null } }
    try { current.start(); setListening(true) }
    catch { recognition.current = null; onError('Impossible de démarrer la dictée. Utilisez le clavier.') }
  }

  function speak(text: string, id: number) {
    if (speaking === id) { stopMedia(); return }
    stopMedia()
    if (!canSpeak) return
    const item = new SpeechSynthesisUtterance(text)
    item.lang = 'fr-FR'
    item.voice = speechSynthesis.getVoices().find(voice => voice.lang.startsWith('fr')) ?? null
    utterance.current = item
    item.onend = () => { if (utterance.current === item) { setSpeaking(null); utterance.current = null } }
    item.onerror = event => {
      if (utterance.current !== item) return
      setSpeaking(null); utterance.current = null
      if (event.error !== 'canceled' && event.error !== 'interrupted') onError('Lecture vocale indisponible sur ce navigateur.')
    }
    try { speechSynthesis.speak(item); setSpeaking(id) }
    catch { setSpeaking(null); onError('Impossible de lancer la lecture vocale.') }
  }

  return { canDictate, canSpeak, listening, speaking, toggleDictation, speak, stopMedia }
}
