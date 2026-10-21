import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import type { Ctx } from './context'
import { clock, dateKey, shortDate } from './model'

type Sky = { code: number | null; label: string; icon: 'sun' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm' }
type Part = Sky & { part: string; hour: number; temperature_c: number | null; rain_chance: number | null }
type WeatherData = {
  station: { timestamp: string; temperature_c: number | null; humidity_pct: number | null; wind_avg_kmh: number | null; rain_today_mm: number | null; stale: boolean } | null
  station_status: string
  forecast: { date: string; today: Sky & { min_c: number | null; max_c: number | null; rain_mm: number | null; rain_chance: number | null; wind_max_kmh: number | null }; parts: Part[] } | null
  forecast_status: 'connected' | 'unavailable' | 'not_configured'
  place: string
  tempo: { date: string; color: 'bleu' | 'blanc' | 'rouge' } | null
  tomorrow: string
}

const degrees = (value: number | null | undefined) => value == null ? '–' : Math.round(value).toString()
const decimal = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const tempoAdvice = {
  bleu: 'Électricité au tarif le plus bas.',
  blanc: 'Tarif intermédiaire en heures pleines (6 h–22 h).',
  rouge: 'Électricité très chère de 6 h à 22 h : on décale machines, sèche-linge et chauffage d’appoint.',
}

// One glance for the whole family: home station now, today's sky, tomorrow's Tempo.
export function Weather({ ctx }: { ctx: Ctx }) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [failed, setFailed] = useState(false)
  const { api, online } = ctx
  const load = useCallback(async () => {
    try { setData(await api('family/weather')); setFailed(false) } catch { setFailed(true) }
  }, [api])
  useEffect(() => {
    if (online) void load()
    const timer = window.setInterval(() => { if (online && !document.hidden) void load() }, 10 * 60000)
    return () => window.clearInterval(timer)
  }, [load, online])

  if (!data) return failed ? null : <section className="weather weather-loading" aria-label="Météo" aria-busy="true"><p className="muted">Météo…</p></section>
  const { station, forecast, tempo } = data
  const today = forecast?.today

  return <section className="weather" aria-labelledby="weather-title">
    <h2 id="weather-title" className="weather-title">Météo{data.place ? ` · ${data.place}` : ''}</h2>
    <div className="weather-grid">
      <div className="weather-now">
        <p className="weather-kicker"><Icon name="thermo" />Dehors</p>
        {station?.temperature_c != null
          ? <><p className="weather-big">{decimal(station.temperature_c)}<span> °C</span></p>
            <p className="weather-note">{station.stale ? `Dernier relevé de la station : ${shortDate(dateKey(new Date(station.timestamp)))} à ${clock(station.timestamp)}` : `Station maison · relevé à ${clock(station.timestamp)}`}</p>
            {(station.humidity_pct != null || station.wind_avg_kmh != null) && <p className="weather-note">
              {station.humidity_pct != null && `Humidité ${Math.round(station.humidity_pct)} %`}{station.humidity_pct != null && station.wind_avg_kmh != null && ' · '}
              {station.wind_avg_kmh != null && `vent ${Math.round(station.wind_avg_kmh)} km/h`}</p>}</>
          : <p className="weather-note">Station maison indisponible pour le moment.</p>}
      </div>

      <div className="weather-today">
        <p className="weather-kicker">Aujourd’hui</p>
        {today ? <>
          <p className="weather-sky"><Icon name={today.icon} />{today.label}</p>
          <p className="weather-range"><span>min <strong>{degrees(today.min_c)}°</strong></span><span>max <strong>{degrees(today.max_c)}°</strong></span></p>
          <p className="weather-note">{today.rain_chance != null && `Pluie ${Math.round(today.rain_chance)} %`}{today.rain_mm ? ` · ${decimal(today.rain_mm)} mm` : ''}{today.wind_max_kmh != null && ` · vent jusqu’à ${Math.round(today.wind_max_kmh)} km/h`}</p>
          {forecast.parts.length > 0 && <ul className="weather-parts">{forecast.parts.map(part => <li key={part.part}>
            <span className="weather-part">{part.part}</span><Icon name={part.icon} /><span className="sr-only">{part.label}, </span>
            <strong>{degrees(part.temperature_c)}°</strong>{part.rain_chance != null && part.rain_chance >= 20 && <span className="weather-rain">{Math.round(part.rain_chance)} %<span className="sr-only"> de risque de pluie</span></span>}
          </li>)}</ul>}
        </> : <p className="weather-note">{data.forecast_status === 'not_configured' ? 'Prévisions à configurer sur le serveur.' : 'Prévisions indisponibles pour le moment.'}</p>}
      </div>

      <div className={`weather-tempo tempo-${tempo?.color ?? 'none'}`}>
        <p className="weather-kicker"><Icon name="bolt" />Tempo demain</p>
        {tempo ? <><p className="tempo-color"><span className="tempo-swatch" aria-hidden="true" />{tempo.color.toUpperCase()}</p><p className="weather-note">{tempoAdvice[tempo.color]}</p></>
          : <p className="weather-note">Couleur pas encore annoncée (en général vers 11 h).</p>}
      </div>
    </div>
  </section>
}
