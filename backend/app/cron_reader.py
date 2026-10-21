"""Standalone, read-only Hermes cron projection; also runs over SSH via stdin.

Only this allowlist leaves Hermes. Prompts, destinations, raw errors and reports
never cross the boundary. No Hermes imports or scheduler calls are made.
"""
import json
import math
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


def stamp(value):
    if not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return date.isoformat() if date.tzinfo else None
    except ValueError:
        return None


def folded(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(c))


def category(name):
    text = folded(name)
    if any(word in text for word in ("linky", "tempo", "bresser", "meteo", "pluviometr", "securite maison")):
        return "maison"
    if any(word in text for word in ("vacances", "voyage")):
        return "voyages"
    if any(word in text for word in ("guitare", "leboncoin")):
        return "veilles"
    return "personnel"


def bounded_read(path, root, limit):
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("Invalid source")
    with resolved.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Source too large")
    return data.decode("utf-8")


def latest_report(root, job_id):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", job_id):
        return ""
    directory = root / "output" / job_id
    if not directory.resolve().is_relative_to(root):
        return ""
    paths = sorted(directory.glob("*.md"), reverse=True)
    # Do not fall back to an older success after an unreadable latest report.
    try:
        return bounded_read(paths[0], root, 131072) if paths else ""
    except (OSError, ValueError, UnicodeError):
        return ""


def weather_from(report):
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", report):
        try:
            value, _ = decoder.raw_decode(report[match.start():])
        except ValueError:
            continue
        if not isinstance(value, dict) or not stamp(value.get("timestamp")):
            continue
        result = {"timestamp": stamp(value["timestamp"])}
        for key, low, high in [("temperature_c", -80, 70), ("humidity_pct", 0, 100),
                               ("wind_avg_kmh", 0, 500), ("rain_today_mm", 0, 3000),
                               ("pressure_hpa", 800, 1200)]:
            number = value.get(key)
            result[key] = number if type(number) in (float, int) and math.isfinite(number) and low <= number <= high else None
        return result
    return None


def project(root):
    root = Path(root).resolve(strict=True)
    raw = json.loads(bounded_read(root / "jobs.json", root, 2097152))
    jobs = raw.get("jobs") if isinstance(raw, dict) else None
    if not isinstance(jobs, list) or len(jobs) > 500:
        raise ValueError("Invalid jobs")
    result = {"checked_at": datetime.now(timezone.utc).isoformat(), "jobs": [], "weather": None, "tempo": None}
    for job in jobs:
        if not isinstance(job, dict):
            raise ValueError("Invalid job")
        name = str(job.get("name") or "Tâche sans nom")[:300]
        enabled = job.get("enabled") is True
        state = "scheduled" if enabled else "completed" if job.get("state") == "completed" else "paused"
        status = job.get("last_status")
        http_code = re.search(r"HTTP\s+(\d{3})", str(job.get("last_error", ""))) if status == "error" else None
        failures = job.get("failure_streak")
        item = {"id": str(job.get("id", ""))[:80], "name": name, "enabled": enabled, "state": state,
                "category": category(name), "last_status": status if status in ("ok", "error") else None,
                "next_run_at": stamp(job.get("next_run_at")) if enabled else None,
                "last_run_at": stamp(job.get("last_run_at")), "no_agent": job.get("no_agent") is True,
                "failure_streak": max(0, failures) if type(failures) is int else 0,
                "error_code": int(http_code.group(1)) if http_code else None}
        result["jobs"].append(item)
        text = folded(name)
        if enabled and "bresser" in text and "collecte" in text:
            result["weather"] = weather_from(latest_report(root, item["id"]))
        if enabled and "tempo" in text and "couleur" in text:
            report = latest_report(root, item["id"])
            match = re.search(r"demain\s*\((\d{4}-\d{2}-\d{2})\)\s*:\s*\*{0,2}(BLEU|BLANC|ROUGE)\b", report, re.I)
            if match:
                result["tempo"] = {"date": match.group(1), "color": match.group(2).lower(), "reported_at": item["last_run_at"]}
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(project(sys.argv[1]), ensure_ascii=False, allow_nan=False))
    except (OSError, ValueError, IndexError, UnicodeError):
        # SSH stderr must never contain a report, credentials or file contents.
        sys.exit(1)
