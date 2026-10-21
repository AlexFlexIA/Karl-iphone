export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function request(path: string, csrf: string | null, options: RequestInit = {}) {
  const writing = !!options.method && options.method !== 'GET'
  let response: Response
  try {
    response = await fetch('/api/' + path, {
      ...options, cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...options.headers },
    })
  } catch {
    throw new ApiError(writing ? 'Connexion interrompue. Vérifiez la liste avant de réessayer.' : 'KARL est injoignable. Les dernières données restent affichées.', 0)
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof result?.detail === 'string' ? result.detail
      : response.status === 422 ? 'Vérifiez les champs du formulaire.' : 'Cette action n’a pas abouti. Actualisez puis réessayez.'
    throw new ApiError(detail, response.status)
  }
  return result
}

// Drafts survive an app update reload, never a sign-out: they live only in this tab.
export function readDraft(key: string) {
  try { return sessionStorage.getItem('karl-draft-' + key) ?? '' } catch { return '' }
}
export function writeDraft(key: string, value: string) {
  try { if (value) sessionStorage.setItem('karl-draft-' + key, value); else sessionStorage.removeItem('karl-draft-' + key) } catch { /* Private mode: drafts stay in memory. */ }
}
export function readPreference(key: string) {
  try { return localStorage.getItem('karl-' + key) } catch { return null }
}
export function writePreference(key: string, value: string) {
  try { localStorage.setItem('karl-' + key, value) } catch { /* Preference is a convenience only. */ }
}
