import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import weather
from app.family import PARIS
from app.main import app


def forecast(day):
    days = [day.isoformat(), (day + timedelta(days=1)).isoformat()]
    hours = [f"{d}T{h:02d}:00" for d in days for h in range(24)]
    return {"daily": {"time": days, "weather_code": [61, 0], "temperature_2m_min": [4.2, 3], "temperature_2m_max": [12.6, 14],
                      "precipitation_sum": [3.4, 0], "precipitation_probability_max": [80, 5], "wind_speed_10m_max": [25, 10]},
            "hourly": {"time": hours, "temperature_2m": [float(i % 24) for i in range(48)], "weather_code": [3] * 48,
                       "precipitation_probability": [40] * 48}}


class WeatherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"KARL_DB_PATH": str(Path(self.temp.name) / "w.db"), "KARL_ACCESS_TOKEN": "owner",
            "KARL_PUBLIC_ORIGIN": "http://localhost", "KARL_WEATHER_LAT": "48.11", "KARL_WEATHER_LON": "-1.68", "KARL_WEATHER_PLACE": "Maison"})
        self.env.start()
        self.client = TestClient(app, base_url="http://localhost")
        self.client.__enter__()
        self.client.post('/api/family/bootstrap', headers={'Origin': 'http://localhost', 'Authorization': 'Bearer owner'}).raise_for_status()
        now = datetime.now(PARIS)
        self.tomorrow = (now.date() + timedelta(days=1)).isoformat()
        self.home = {"source_status": "connected", "jobs": [{"name": "secret job"}],
                     "weather": {"timestamp": (now - timedelta(minutes=10)).astimezone(timezone.utc).isoformat(), "temperature_c": 6.3,
                                 "humidity_pct": 90, "wind_avg_kmh": 5, "rain_today_mm": 0.4, "pressure_hpa": 1012},
                     "tempo": {"date": self.tomorrow, "color": "rouge", "reported_at": None}}
        app.state.crons.read = AsyncMock(return_value=self.home)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def test_crosses_station_forecast_and_tempo_without_leaking_jobs(self):
        with patch.object(weather, 'fetch', AsyncMock(return_value=forecast(datetime.now(PARIS).date()))) as fetch:
            data = self.client.get('/api/family/weather').json()
            self.client.get('/api/family/weather')
        fetch.assert_awaited_once()
        self.assertEqual(fetch.call_args.args, (48.11, -1.68))
        self.assertNotIn('jobs', data)
        self.assertEqual((data['station']['temperature_c'], data['station']['stale']), (6.3, False))
        self.assertEqual(data['forecast']['today']['label'], 'Pluie faible')
        self.assertEqual((data['forecast']['today']['min_c'], data['forecast']['today']['max_c']), (4.2, 12.6))
        self.assertEqual([(p['part'], p['temperature_c']) for p in data['forecast']['parts']], [('Matin', 8.0), ('Après-midi', 14.0), ('Soir', 19.0)])
        self.assertEqual(data['tempo'], {'date': self.tomorrow, 'color': 'rouge'})
        self.assertEqual(data['place'], 'Maison')

    def test_old_tempo_stale_station_and_forecast_outage_are_reported_not_guessed(self):
        self.home['tempo']['date'] = '2020-01-01'
        self.home['weather']['timestamp'] = '2020-01-01T06:00:00+00:00'
        with patch.object(weather, 'fetch', AsyncMock(side_effect=weather.httpx.ConnectError('down'))):
            data = self.client.get('/api/family/weather').json()
        self.assertIsNone(data['tempo'])
        self.assertTrue(data['station']['stale'])
        self.assertEqual((data['forecast'], data['forecast_status']), (None, 'unavailable'))
        with patch.dict(os.environ, {'KARL_WEATHER_LAT': ''}):
            app.state.forecast = weather.Forecast()
            self.assertEqual(self.client.get('/api/family/weather').json()['forecast_status'], 'not_configured')

    def test_requires_a_family_session(self):
        self.client.cookies.clear()
        self.assertEqual(self.client.get('/api/family/weather').status_code, 401)


if __name__ == '__main__':
    unittest.main()
