import { useCallback, useEffect, useState } from 'react'
import { Icon } from './icons'

type Job = {
  id: string; name: string; enabled: boolean; state: 'scheduled' | 'paused' | 'completed'
  category: string; last_status: 'ok' | 'error' | null; next_run_at: string | null
  last_run_at: string | null; no_agent: boolean; failure_streak: number; error_code: number | null
}
type CronData = {
  source_status: 'connected' | 'unavailable' | 'not_configured'; checked_at: string | null; jobs: Job[]
  weather: { timestamp: string; temperature_c: number | null; humidity_pct: number | null; wind_avg_kmh: number | null; rain_today_mm: number | null; pressure_hpa: number | null } | null
  tempo: { date: string; color: 'bleu' | 'blanc' | 'rouge'; reported_at: string | null } | null
}
const zone = 'Europe/Paris'
const formatNumber = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
function when(value: string | null, day = false) {
  if (!value) return 'Jamais exécuté'
  return new Date(value).toLocaleString('fr-FR', { timeZone: zone, ...(day ? { day: 'numeric', month: 'short' } as const : {}), hour: '2-digit', minute: '2-digit' })
}
function dayKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
function JobResult({ job }: { job: Job }) {
  return <span className={`job-result ${job.last_status === 'error' ? 'failed' : ''}`}>{job.last_status === 'error' ? 'En échec' : job.last_status === 'ok' ? 'Exécuté' : 'Pas encore exécuté'}</span>
}

export function CronDashboard({ view, api, online }: {
  view: 'today' | 'home'; api: (path: string, options?: RequestInit) => Promise<CronData>; online: boolean
}) {
  const [data, setData] = useState<CronData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    try {
      const result = await api('dashboard', { signal })
      if (!signal.aborted) { setData(result); setError('') }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Lecture indisponible. Réessayez.') }
    finally { if (!signal.aborted) setLoading(false) }
  }, [api])
  useEffect(() => {
    const controller = new AbortController()
    if (online) void refresh(controller.signal)
    else setLoading(false)
    const timer = window.setInterval(() => { if (online && !document.hidden) void refresh(controller.signal) }, 60000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [refresh, online])

  const active = data?.jobs.filter(job => job.enabled) ?? []
  const errors = active.filter(job => job.last_status === 'error')
  const upcoming = active.filter(job => job.next_run_at).sort((a, b) => Date.parse(a.next_run_at!) - Date.parse(b.next_run_at!)).slice(0, 8)
  const briefs = active.filter(job => /brief/i.test(job.name))
  const now = new Date()
  // Use Paris calendar days even when the phone is in another time zone.
  const tomorrow = new Date(Date.parse(dayKey(now) + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  const weather = data?.weather
  const age = weather ? now.valueOf() - Date.parse(weather.timestamp) : Infinity
  const weatherOld = age > 90 * 60000 || age < -5 * 60000
  const tempo = data?.tempo
  const tempoCurrent = tempo?.date === tomorrow
  const linky = active.find(job => /linky.*collecte/i.test(job.name))
  const security = active.find(job => /brief.*sécurité/i.test(job.name))
  const sourceLost = !!data && (data.source_status !== 'connected' || !!error || !online)

  return <section className="cron-dashboard" aria-label={view === 'today' ? 'Aujourd’hui' : 'Maison'}>
    <div className="section-heading"><div><h1>{view === 'today' ? 'Gardez le fil.' : 'La maison, en direct.'}</h1><p>{view === 'today' ? now.toLocaleDateString('fr-FR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }) : 'Météo Bresser, Tempo et suivi électrique.'}</p></div><button className="secondary-button" onClick={() => void refresh(new AbortController().signal)} disabled={loading || !online}><Icon name="refresh" className={loading ? 'rotating' : ''} /><span>{loading ? 'Lecture…' : 'Actualiser'}</span></button></div>
    <div className="source-caption"><span className={`source-dot ${sourceLost ? 'old' : ''}`} />{data?.checked_at ? `Relevé du ${when(data.checked_at, true)}` : 'Hermes personnel'}<span>Lecture seule</span></div>
    {error && <p className="source-warning" role="alert">{error}{data?.checked_at ? ' Les données précédentes sont conservées.' : ''}</p>}
    {data?.source_status === 'unavailable' && <p className="source-warning" role="status">Lecture d’Hermes indisponible.{data.checked_at ? ' Ces données proviennent du dernier relevé réussi.' : ' Vérifiez la liaison privée, puis actualisez.'}</p>}
    {data?.source_status === 'not_configured' && <div className="cron-empty"><h2>Vos tâches bientôt ici.</h2><p>La lecture des tâches d’Hermes doit être configurée dans KARL.</p></div>}
    {!data && <p className="loading-state" role="status">{loading ? 'Lecture des tâches et des relevés…' : 'Aucun relevé disponible. Actualisez après reconnexion.'}</p>}
    {data?.checked_at && <>
      {view === 'today' ? <>
        <div className="cron-totals" aria-label="État des tâches"><span><strong>{active.length}</strong> actives</span><span><strong>{data.jobs.filter(job => job.state === 'paused').length}</strong> en pause</span><span><strong>{data.jobs.filter(job => job.state === 'completed').length}</strong> terminées</span></div>
        {errors.length > 0 && <section className="attention-panel"><h2>À regarder <span>{errors.length}</span></h2>{errors.map(job => <div key={job.id}><strong>{job.name}</strong><p>{job.failure_streak > 0 ? `${job.failure_streak} échec${job.failure_streak > 1 ? 's' : ''} consécutif${job.failure_streak > 1 ? 's' : ''}. ` : ''}{job.error_code ? `Erreur HTTP ${job.error_code}. ` : ''}Dernier essai : {when(job.last_run_at, true)}.</p></div>)}</section>}
        <div className="today-columns"><section className="agenda"><h2>À venir</h2><p className="section-note">Prochains passages annoncés · heure de Paris</p>{!upcoming.length && <p className="section-note">Aucune tâche active avec un prochain passage annoncé.</p>}<ol>{upcoming.map(job => <li key={job.id}><time dateTime={job.next_run_at!}>{when(job.next_run_at, dayKey(new Date(job.next_run_at!)) !== dayKey(now))}</time><div><strong>{job.name}</strong><span>{Date.parse(job.next_run_at!) < now.valueOf() - 60000 ? 'Horaire dépassé · en attente de mise à jour' : job.no_agent ? 'Collecte automatique' : 'Tâche planifiée'}</span></div></li>)}</ol></section>
        <section className="briefs"><h2>Vos briefs</h2><p className="section-note">Dernière exécution connue</p>{!briefs.length && <p className="section-note">Aucun brief actif trouvé.</p>}{briefs.map(job => <article key={job.id}><h3>{job.name}</h3><JobResult job={job} /><p>{when(job.last_run_at, true)}</p></article>)}<p className="section-note">« Exécuté » décrit la tâche ; cela ne confirme pas la réception d’une notification.</p></section></div>
      </> : <>
        <div className="home-grid"><section className="weather-panel"><div className="weather-heading"><h2>Météo maison</h2><span>{weather ? weatherOld ? 'Relevé ancien' : sourceLost ? 'Dernier relevé connu' : 'Relevé récent' : 'Indisponible'}</span></div><div className="temperature">{formatNumber(weather?.temperature_c)}<span>°C</span></div><p>{weather ? `Mesuré le ${when(weather.timestamp, true)}` : 'Aucune mesure Bresser lisible.'}</p><dl className="weather-measures"><div><dt>Humidité</dt><dd>{formatNumber(weather?.humidity_pct)}<small> %</small></dd></div><div><dt>Vent moyen</dt><dd>{formatNumber(weather?.wind_avg_kmh)}<small> km/h</small></dd></div><div><dt>Pluie du jour</dt><dd>{formatNumber(weather?.rain_today_mm)}<small> mm</small></dd></div></dl>{weatherOld && weather && <p className="reading-caution">Ce relevé a plus de 90 minutes ou sa date est incohérente. Il ne décrit peut-être plus la météo actuelle.</p>}</section>
        <section className={`tempo-panel tempo-${tempo?.color ?? 'unknown'}`}><h2>Tempo · demain</h2><strong>{tempoCurrent ? tempo!.color : 'À confirmer'}</strong><p>{tempo ? `${tempoCurrent ? 'Couleur annoncée pour le' : 'Dernière couleur connue : ' + tempo.color + ' ·'} ${new Date(tempo.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: zone, day: 'numeric', month: 'long' })}` : 'Aucune couleur lisible pour demain.'}</p>{tempo?.reported_at && <span>Collecté le {when(tempo.reported_at, true)}</span>}</section></div>
        <div className="house-followup"><section><h2>Électricité · Linky</h2>{linky ? <><JobResult job={linky} /><p>{linky.last_status === 'error' ? `Collecte indisponible${linky.error_code ? ` · HTTP ${linky.error_code}` : ''}. ${linky.failure_streak} échecs consécutifs.` : 'Collecte exécutée. Les mesures de consommation ne sont pas encore disponibles dans KARL.'}</p><span>Dernier essai : {when(linky.last_run_at, true)}</span></> : <p>Aucune collecte active trouvée.</p>}<p className="section-note">Aucune consommation estimée à partir de données manquantes.</p></section><section><h2>Brief sécurité maison</h2>{security ? <><JobResult job={security} /><p>Dernier passage : {when(security.last_run_at, true)}.</p><span>Prochain passage : {when(security.next_run_at, true)}</span></> : <p>Aucun brief actif trouvé.</p>}<p className="section-note">État du brief uniquement ; aucune confirmation de l’état des équipements.</p></section></div>
      </>}
      <p className="cron-footer">Actualisation chaque minute lorsque cette vue est visible. Aucun lancement de tâche ni appel à l’IA.</p>
    </>}
  </section>
}
