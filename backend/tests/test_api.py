import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app import hermes
from app.main import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "KARL_DB_PATH": str(Path(self.temp.name) / "test.db"),
            "KARL_ACCESS_TOKEN": "test-karl-secret",
            "HERMES_API_KEY": "test-hermes-secret",
            "HERMES_API_URL": "http://hermes.test/v1",
        })
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()
        self.headers = {"Authorization": "Bearer test-karl-secret"}
        self.conversation_id = str(uuid4())

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.temp.cleanup()

    def post(self, message="Bonjour"):
        return self.client.post("/api/chat", headers=self.headers,
                                json={"conversation_id": self.conversation_id, "message": message})

    def transport(self, handler):
        client_class = httpx.AsyncClient
        return patch.object(hermes.httpx, "AsyncClient", side_effect=lambda **kw: client_class(
            transport=httpx.MockTransport(handler), **kw))

    def test_api_is_private_and_missing_configuration_fails_closed(self):
        for method, path, body in [
            ("GET", "/api/health", None),
            ("GET", f"/api/conversations/{self.conversation_id}", None),
            ("POST", "/api/chat", {"conversation_id": self.conversation_id, "message": "Hi"}),
        ]:
            self.assertEqual(self.client.request(method, path, json=body).status_code, 401)
        with patch.dict(os.environ, {"KARL_ACCESS_TOKEN": ""}):
            self.assertEqual(self.client.get("/api/health", headers=self.headers).status_code, 503)

    def test_chat_roundtrip_persists_and_forwards_history(self):
        requests = []

        def handler(request):
            self.assertEqual(str(request.url), "http://hermes.test/v1/chat/completions")
            self.assertEqual(request.headers["Authorization"], "Bearer test-hermes-secret")
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [
                {"finish_reason": "stop", "message": {"content": "Bonjour Alex"}}]})

        with self.transport(handler):
            self.assertEqual(self.post().json(), {"reply": "Bonjour Alex"})
            self.assertEqual(self.post("Et ensuite ?").status_code, 200)
        self.assertEqual([m["role"] for m in requests[1]["messages"]], ["user", "assistant", "user"])
        response = self.client.get(f"/api/conversations/{self.conversation_id}", headers=self.headers)
        self.assertEqual(len(response.json()["messages"]), 4)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(self.client.get("/api/health", headers=self.headers).json()["messages"], 4)
        other = self.client.get(f"/api/conversations/{uuid4()}", headers=self.headers)
        self.assertEqual(other.json()["messages"], [])

    def test_upstream_error_or_cancelled_turn_does_not_save_messages(self):
        for status, payload in [(500, {"secret": "must-not-leak"}),
                                (200, {"choices": [{"finish_reason": "cancelled", "message": {"content": "partial"}}]}),
                                (200, {"choices": []})]:
            with self.transport(lambda request: httpx.Response(status, json=payload)):
                response = self.post()
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("must-not-leak", response.text)
        self.assertEqual(self.client.get("/api/health", headers=self.headers).json()["messages"], 0)

    def test_missing_hermes_key_and_blank_prompt(self):
        with patch.dict(os.environ, {"HERMES_API_KEY": ""}):
            self.assertEqual(self.post().status_code, 502)
        for message in ["   ", "x" * 4001]:
            self.assertEqual(self.post(message).status_code, 422)


if __name__ == "__main__":
    unittest.main()
