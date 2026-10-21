"""Family weather card: home station reading + Tempo (from the read-only Hermes cron
projection) crossed with a public forecast. Exposes no job, report or prompt."""
import asyncio
import math
import os
import time
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, Request

from .family import PARIS
from .family_auth import member

router = APIRouter(prefix="/api/family")

# WMO weather codes → (label, icon). https://open-meteo.com/en/docs
CODES = {0: ("Ciel dégagé", "sun"), 1: ("Plutôt ensoleillé", "sun"), 2: ("Éclaircies", "partly"), 3: ("Couvert", "cloud"),
         45: ("Brouillard", "fog"), 48: ("Brouillard givrant", "fog"),
         51: ("Bruine légère", "drizzle"), 53: ("Bruine", "drizzle"), 55: ("Bruine forte", "drizzle"),
         56: ("Bruine verglaçante", "drizzle"), 57: ("Bruine verglaçante", "drizzle"),
         61: ("Pluie faible", "rain"), 63: ("Pluie", "rain"), 65: ("Forte pluie", "rain"),
         66: ("Pluie verglaçante", "rain"), 67: ("Pluie verglaçante", "rain"),
         71: ("Neige faible", "snow"), 73: ("Neige", "snow"), 75: ("Forte neige", "snow"), 77: ("Grains de neige", "snow"),
         80: ("Averses", "rain"), 81: ("Averses", "rain"), 82: ("Fortes averses", "rain"),
         85: ("Averses de neige", "snow"), 86: ("Averses de neige", "snow"),
         95: ("Orages", "storm"), 96: ("Orages et grêle", "storm"), 99: ("Orages et grêle", "storm")}
PARTS = (("Matin", 8), ("Après-midi", 14), ("Soir", 19))


class Forecast:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.cached = None
        self.attempt_at = float("-inf")

    def place(self):
        try:
            lat, lon = float(os.getenv("KARL_WEATHER_LAT", "")), float(os.getenv("KARL_WEATHER_LON", ""))
        except ValueError:
            return None
        return (lat, lon) if -90 <= lat <= 90 and -180 <= lon <= 180 else None

    async def read(self):
        place = self.place()
        if not place:
            return None, "not_configured"
        async with self.lock:
            # A failed call is retried after 5 minutes; a good one is kept 30 minutes.
            if time.monotonic() - self.attempt_at >= (1800 if self.cached else 300):
                self.attempt_at = time.monotonic()
                try:
                    self.cached = parse(await fetch(*place))
                except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
                    pass
            fresh = self.cached and self.cached["date"] == datetime.now(PARIS).date().isoformat()
            return (self.cached if fresh else None), ("connected" if fresh else "unavailable")


async def fetch(lat, lon):
    url = os.getenv("KARL_WEATHER_URL", "https://api.open-meteo.com/v1/forecast")
    params = {"latitude": lat, "longitude": lon, "timezone": "Europe/Paris", "forecast_days": 2,
              "models": os.getenv("KARL_WEATHER_MODEL", "meteofrance_seamless"),
              "daily": "weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
              "hourly": "temperature_2m,weather_code,precipitation_probability"}
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


def number(value, low, high):
    return round(value, 1) if type(value) in (int, float) and math.isfinite(value) and low <= value <= high else None


def describe(code):
    label, icon = CODES.get(code if type(code) is int else -1, ("Temps incertain", "cloud"))
    return {"code": code if type(code) is int else None, "label": label, "icon": icon}


def parse(raw):
    daily, hourly = raw["daily"], raw["hourly"]
    today = datetime.now(PARIS).date().isoformat()
    index = daily["time"].index(today)
    day = {**describe(daily["weather_code"][index]),
           "min_c": number(daily["temperature_2m_min"][index], -80, 70), "max_c": number(daily["temperature_2m_max"][index], -80, 70),
           "rain_mm": number(daily["precipitation_sum"][index], 0, 3000),
           "rain_chance": number(daily["precipitation_probability_max"][index], 0, 100),
           "wind_max_kmh": number(daily["wind_speed_10m_max"][index], 0, 500)}
    parts = []
    for label, hour in PARTS:
        key = f"{today}T{hour:02d}:00"
        if key in hourly["time"]:
            at = hourly["time"].index(key)
            parts.append({"part": label, "hour": hour, **describe(hourly["weather_code"][at]),
                          "temperature_c": number(hourly["temperature_2m"][at], -80, 70),
                          "rain_chance": number(hourly["precipitation_probability"][at], 0, 100)})
    return {"date": today, "today": day, "parts": parts}


@router.get("/weather")
async def weather(request: Request, user=Depends(member)):
    home, (forecast, forecast_status) = await request.app.state.crons.read(), await request.app.state.forecast.read()
    now = datetime.now(PARIS)
    station = home.get("weather")
    if station:
        age = now - datetime.fromisoformat(station["timestamp"])
        station = {**station, "stale": not timedelta(minutes=-5) <= age <= timedelta(minutes=90)}
    tempo = home.get("tempo")
    tomorrow = (now.date() + timedelta(days=1)).isoformat()
    return {"station": station, "station_status": home.get("source_status"),
            "forecast": forecast, "forecast_status": forecast_status, "place": os.getenv("KARL_WEATHER_PLACE", "")[:60],
            "tempo": {"date": tempo["date"], "color": tempo["color"]} if tempo and tempo.get("date") == tomorrow else None,
            "tomorrow": tomorrow}
