"""Only boundary with Hermes: no CLI, config writes or process management."""

import os
import time

import httpx


class HermesUnavailable(Exception):
    pass


async def status() -> dict:
    """Probe the advertised models only; never trigger an agent run."""
    key = os.getenv("HERMES_API_KEY", "")
    if not key:
        return {"status": "not_configured", "latency_ms": None}
    base = os.getenv("HERMES_API_URL", "http://127.0.0.1:8642/v1").rstrip("/")
    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"})
        if response.status_code in (401, 403):
            return {"status": "unauthorized", "latency_ms": None}
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
            raise ValueError("Unexpected model catalogue")
        return {"status": "connected", "latency_ms": round((time.monotonic() - start) * 1000)}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"status": "unavailable", "latency_ms": None}


async def complete(messages: list[dict[str, str]]) -> str:
    key = os.getenv("HERMES_API_KEY", "")
    if not key:
        raise HermesUnavailable("Connexion Hermes à configurer côté serveur.")
    base = os.getenv("HERMES_API_URL", "http://127.0.0.1:8642/v1").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                f"{base}/chat/completions",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": os.getenv("HERMES_MODEL", "hermes-agent"),
                      "messages": messages, "stream": False},
            )
            response.raise_for_status()
            choice = response.json()["choices"][0]
            reply = choice["message"]["content"]
            if choice.get("finish_reason") != "stop" or not isinstance(reply, str) or not reply.strip():
                raise ValueError("No complete text reply")
            return reply
    except httpx.TimeoutException as exc:
        raise HermesUnavailable("Délai dépassé. Vérifier Hermes avant de renvoyer : la demande peut continuer côté serveur.") from exc
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        # Never send upstream bodies (potentially secrets/tool output) to the UI.
        raise HermesUnavailable("Hermes n'a pas fourni de réponse complète. Vérifier sa connexion.") from exc
