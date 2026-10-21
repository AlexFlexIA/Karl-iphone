import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.cron_reader import project, weather_from
from app.crons import CronSource
from app.main import app


class CronTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.jobs = [
            {"id": "weather", "name": "Bresser — collecte historique", "enabled": True, "state": "scheduled",
             "last_run_at": "2026-10-18T12:45:00+02:00", "last_status": "ok", "failure_streak": 0,
             "next_run_at": "2026-10-18T13:15:00+02:00", "no_agent": True, "prompt": "PRIVATE_PROMPT", "deliver": "PRIVATE_CHAT"},
            {"id": "linky", "name": "Linky — collecte", "enabled": True, "last_status": "error",
             "failure_streak": 7, "last_error": "PRIVATE_ERROR HTTP 409", "next_run_at": "2026-10-18T13:00:00+02:00"},
            {"id": "tempo", "name": "Tempo - couleur de demain", "enabled": True, "last_status": "ok"},
            {"id": "paused", "name": "Voyage en pause", "enabled": False, "state": "paused", "next_run_at": "2020-01-01T10:00:00+00:00"},
            {"id": "done", "name": "Rappel terminé", "enabled": False, "state": "completed"},
        ]
        self.save()
        self.report("weather", 'Mesure\n{"timestamp":"2026-10-18T12:36:00+02:00","temperature_c":0,"humidity_pct":null,"wind_avg_kmh":4.7,"rain_today_mm":0,"station_id":"PRIVATE_STATION"}')
        self.report("tempo", 'TEMPO — demain (2026-10-19) : **BLEU**.')

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        (self.root / "jobs.json").write_text(json.dumps({"jobs": self.jobs}))

    def report(self, job, text, filename="2026-10-18_12-45-00.md"):
        directory = self.root / "output" / job
        directory.mkdir(parents=True, exist_ok=True)
        (directory / filename).write_text(text)

    def test_projection_excludes_private_fields_and_preserves_missing_vs_zero(self):
        data = project(self.root)
        self.assertNotIn("PRIVATE", json.dumps(data))
        self.assertEqual(data["weather"]["temperature_c"], 0)
        self.assertEqual(data["weather"]["rain_today_mm"], 0)
        self.assertIsNone(data["weather"]["humidity_pct"])
        self.assertEqual(data["weather"]["timestamp"], "2026-10-18T12:36:00+02:00")
        self.assertEqual(data["tempo"]["color"], "bleu")
        self.assertEqual(data["jobs"][1]["error_code"], 409)
        self.assertIsNone(data["jobs"][3]["next_run_at"])
        self.assertEqual(data["jobs"][4]["state"], "completed")
        self.assertEqual(data["jobs"][0]["category"], "maison")

    def test_latest_failed_or_malformed_report_does_not_resurrect_old_measurement(self):
        self.report("weather", "Collection failed PRIVATE_ERROR", "2026-10-18_13-45-00.md")
        self.assertIsNone(project(self.root)["weather"])
        self.assertIsNone(weather_from('{"timestamp":"not-a-date","temperature_c":20}'))
        result = weather_from('{"timestamp":"2026-10-18T12:00:00Z","temperature_c":true,"humidity_pct":999,"wind_avg_kmh":NaN}')
        self.assertIsNone(result["temperature_c"])
        self.assertIsNone(result["humidity_pct"])
        self.assertIsNone(result["wind_avg_kmh"])

    def test_path_traversal_and_symlink_reports_are_rejected(self):
        self.jobs[0]["id"] = "../../outside"
        self.save()
        self.assertIsNone(project(self.root)["weather"])
        self.jobs[0]["id"] = "weather"
        self.save()
        with tempfile.TemporaryDirectory() as elsewhere:
            secret = Path(elsewhere) / "private.md"
            secret.write_text('PRIVATE_STATION {"timestamp":"2026-10-18T12:00:00Z","temperature_c":30}')
            (self.root / "output/weather/2026-10-18_14-45-00.md").symlink_to(secret)
            self.assertIsNone(project(self.root)["weather"])

    def test_cache_and_source_failure_are_explicit_and_do_not_fake_live_data(self):
        async def run():
            source = CronSource()
            with patch.dict(os.environ, {"HERMES_CRON_DIR": str(self.root), "HERMES_CRON_SSH_HOST": ""}):
                first = await source.read()
                self.assertEqual(first["source_status"], "connected")
                (self.root / "jobs.json").write_text("invalid JSON")
                self.assertEqual((await source.read())["source_status"], "connected")
                source.attempt_at = float("-inf")
                failed = await source.read()
                self.assertEqual(failed["source_status"], "unavailable")
                self.assertEqual(failed["checked_at"], first["checked_at"])
                self.assertEqual(failed["jobs"], first["jobs"])
            with patch.dict(os.environ, {"HERMES_CRON_DIR": ""}):
                self.assertEqual((await source.read())["source_status"], "not_configured")
        asyncio.run(run())

    def test_authenticated_endpoint_is_no_store_and_read_only(self):
        with patch.dict(os.environ, {"HERMES_CRON_DIR": str(self.root), "HERMES_CRON_SSH_HOST": "",
                                    "KARL_DB_PATH": str(self.root / "test.db"), "KARL_ACCESS_TOKEN": "test-key"}):
            with TestClient(app) as client:
                before = (self.root / "jobs.json").read_bytes()
                response = client.get("/api/dashboard", headers={"Authorization": "Bearer test-key"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertEqual(len(response.json()["jobs"]), 5)
                self.assertEqual(client.post("/api/dashboard", headers={"Authorization": "Bearer test-key"}).status_code, 405)
                self.assertEqual((self.root / "jobs.json").read_bytes(), before)
                self.assertNotIn("PRIVATE", response.text)


if __name__ == "__main__":
    unittest.main()
