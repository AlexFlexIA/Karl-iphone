import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './Root'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register('/sw.js').then(registration => {
    // A new shell took over: offer a reload instead of swapping the page under the user.
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) window.dispatchEvent(new Event('karl:update')) })
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void registration.update().catch(() => {}) })
  }).catch(() => { /* KARL remains available without offline shell. */ })
}
