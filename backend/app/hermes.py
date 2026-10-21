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


class Timeout(Exception):
    pass


class Failed(Exception):
    pass


async def reply(base: str, key: str, model: str, messages: list[dict[str, str]]) -> str:
    """One non-streamed completion from a Hermes API server, shared by the personal and the family profiles.
    Raises Timeout or Failed; callers choose the wording, and upstream bodies are never forwarded."""
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(f"{base.rstrip('/')}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                         json={"model": model, "messages": messages, "stream": False})
            response.raise_for_status()
            choice = response.json()["choices"][0]
            text = choice["message"]["content"]
            if choice.get("finish_reason") != "stop" or not isinstance(text, str) or not text.strip():
                raise ValueError("No complete text reply")
            return text
    except httpx.TimeoutException as exc:
        raise Timeout() from exc
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        raise Failed() from exc


async def complete(messages: list[dict[str, str]]) -> str:
    key = os.getenv("HERMES_API_KEY", "")
    if not key:
        raise HermesUnavailable("Connexion Hermes à configurer côté serveur.")
    try:
        return await reply(os.getenv("HERMES_API_URL", "http://127.0.0.1:8642/v1"), key, os.getenv("HERMES_MODEL", "hermes-agent"), messages)
    except Timeout as exc:
        raise HermesUnavailable("Délai dépassé. Vérifier Hermes avant de renvoyer : la demande peut continuer côté serveur.") from exc
    except Failed as exc:
        raise HermesUnavailable("Hermes n'a pas fourni de réponse complète. Vérifier sa connexion.") from exc
