"""Read-only local/SSH adapter. Source settings are server-only, never HTTP input."""
import asyncio
import json
import os
import re
import shlex
import time
from pathlib import Path

from .cron_reader import project


class CronSource:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.cached = None
        self.attempt_at = float("-inf")
        self.state = "not_configured"

    async def read(self):
        root = os.getenv("HERMES_CRON_DIR", "")
        if not root:
            return {"source_status": "not_configured", "checked_at": None, "jobs": [], "weather": None, "tempo": None}
        async with self.lock:
            if time.monotonic() - self.attempt_at >= 20:
                try:
                    host = os.getenv("HERMES_CRON_SSH_HOST", "")
                    if host:
                        data = await self.remote(host, root)
                    else:
                        data = await asyncio.to_thread(project, root)
                    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list) or not data.get("checked_at"):
                        raise ValueError("Invalid projection")
                    self.cached = data
                    self.state = "connected"
                except (OSError, ValueError, asyncio.TimeoutError):
                    self.state = "unavailable"
                self.attempt_at = time.monotonic()
            return {**(self.cached or {"checked_at": None, "jobs": [], "weather": None, "tempo": None}), "source_status": self.state}

    async def remote(self, host, root):
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,200}", host):
            raise ValueError("Invalid SSH host")
        user = os.getenv("HERMES_CRON_READ_USER", "")
        if user and not re.fullmatch(r"[a-z_][a-z0-9_-]{0,63}", user):
            raise ValueError("Invalid reader user")
        command = (["sudo", "-n", "-u", user] if user else []) + ["python3", "-", root]
        script = Path(__file__).with_name("cron_reader.py").read_bytes()
        process = await asyncio.create_subprocess_exec(
            "ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=yes",
            host, shlex.join(command), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            output, _ = await asyncio.wait_for(process.communicate(script), timeout=10)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            process.kill()
            await process.wait()
            raise
        if process.returncode or len(output) > 1048576:
            raise ValueError("Cron source unavailable")
        return json.loads(output)
