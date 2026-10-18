import asyncio
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import hermes


def db_path() -> Path:
    return Path(os.getenv("KARL_DB_PATH", "karl.db"))


def database():
    return closing(sqlite3.connect(db_path(), timeout=5))


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_path().parent.mkdir(parents=True, exist_ok=True)
    with database() as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL,
            role TEXT NOT NULL, content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
        db.execute("CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, id)")
    app.state.chat_lock = asyncio.Lock()
    yield


security = HTTPBearer(auto_error=False)


def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    token = os.getenv("KARL_ACCESS_TOKEN", "")
    if not token:
        raise HTTPException(503, "Définir KARL_ACCESS_TOKEN côté serveur.")
    if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), token.encode()):
        raise HTTPException(401, "Clé KARL invalide.", headers={"WWW-Authenticate": "Bearer"})


app = FastAPI(title="KARL", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class ChatRequest(BaseModel):
    conversation_id: UUID
    message: str = Field(min_length=1, max_length=4000)


def history(conversation_id: UUID, limit: int = 200) -> list[dict[str, str]]:
    with database() as db:
        rows = db.execute(
            "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
            (str(conversation_id), limit),
        ).fetchall()
    return [{"role": role, "content": content} for role, content in reversed(rows)]


@app.get("/api/health", dependencies=[Depends(authenticate)])
def health():
    with database() as db:
        count = db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    return {"status": "ok", "hermes_configured": bool(os.getenv("HERMES_API_KEY")), "messages": count}


@app.get("/api/conversations/{conversation_id}", dependencies=[Depends(authenticate)])
def conversation(conversation_id: UUID):
    return {"messages": history(conversation_id)}


@app.post("/api/chat", dependencies=[Depends(authenticate)])
async def chat(body: ChatRequest, request: Request):
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Écrire un message avant l'envoi.")
    if request.app.state.chat_lock.locked():
        raise HTTPException(409, "Un échange est déjà en cours. Attendre sa réponse.")
    async with request.app.state.chat_lock:
        messages = history(body.conversation_id, limit=20)
        messages.append({"role": "user", "content": message})
        try:
            reply = await hermes.complete(messages)
        except hermes.HermesUnavailable as exc:
            raise HTTPException(502, str(exc)) from exc
        with database() as db, db:
            db.executemany("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
                           [(str(body.conversation_id), "user", message),
                            (str(body.conversation_id), "assistant", reply)])
    return {"reply": reply}


dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="pwa")
