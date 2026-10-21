import asyncio
import os
import secrets
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import hermes
from .crons import CronSource
from . import assistant, family_auth, family, meals, weather
from .store import db_path, database


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
    app.state.crons = CronSource()
    app.state.forecast = weather.Forecast()
    family_auth.initialize()
    meals.initialize()
    assistant.initialize()
    yield


security = HTTPBearer(auto_error=False)


def authenticate(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    token = os.getenv("KARL_ACCESS_TOKEN", "")
    if not token:
        raise HTTPException(503, "Définir KARL_ACCESS_TOKEN côté serveur.")
    if credentials is None or not secrets.compare_digest(credentials.credentials.encode(), token.encode()):
        raise HTTPException(401, "Clé KARL invalide.", headers={"WWW-Authenticate": "Bearer"})


app = FastAPI(title="KARL", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(family_auth.router)
app.include_router(family.router)
app.include_router(meals.router)
app.include_router(assistant.router)
app.include_router(weather.router)


@app.post("/api/family/bootstrap", dependencies=[Depends(authenticate)])
def family_owner(request: Request, response: family_auth.Response):
    return family_auth.owner_login(request, response)


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class ChatRequest(BaseModel):
    conversation_id: UUID
    message: str = Field(min_length=1, max_length=4000)
    # Opt-in per message: the household summary is sent with this turn only, never stored.
    family_context: bool = False


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


@app.get("/api/status", dependencies=[Depends(authenticate)])
async def status(request: Request):
    probe = await hermes.status()
    with database() as db:
        count, conversations = db.execute("SELECT COUNT(*), COUNT(DISTINCT conversation_id) FROM messages").fetchone()
        last_message = db.execute("SELECT MAX(created_at) FROM messages").fetchone()[0]
    return {"hermes": probe, "messages": count, "conversations": conversations,
            "last_message_at": last_message, "busy": request.app.state.chat_lock.locked(),
            "checked_at": datetime.now(timezone.utc).isoformat()}


@app.get("/api/drive/list", dependencies=[Depends(authenticate)])
def drive_list():
    """The family items still to buy, for the owner to hand to their own Hermes. Nothing is sent from here."""
    with database() as db:
        rows = db.execute("""SELECT name,quantity,category FROM family_items WHERE deleted=0 AND checked=0
            ORDER BY category,name COLLATE NOCASE LIMIT 300""").fetchall()
    return {"items": [dict(row) for row in rows]}


# Family content only: sessions, invitations and sign-in state are secrets, never exported.
BACKUP_TABLES = ["family_members", "family_items", "family_events", "family_event_replies", "family_tasks", "family_recipes",
                 "family_meals", "family_threads", "family_thread_messages", "family_memory", "messages"]


@app.get("/api/backup", dependencies=[Depends(authenticate)])
def backup():
    with database() as db:
        data = {table: [dict(row) for row in db.execute(f"SELECT * FROM {table}")] for table in BACKUP_TABLES}
    for member in data["family_members"]:
        member.pop("google_sub", None)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    return JSONResponse({"exported_at": datetime.now(timezone.utc).isoformat(), "tables": data},
                        headers={"Content-Disposition": f'attachment; filename="karl-sauvegarde-{stamp}.json"'})


@app.get("/api/conversations", dependencies=[Depends(authenticate)])
def conversations(offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
    with database() as db:
        rows = db.execute("""SELECT conversation_id, MIN(id) AS first_id,
            MAX(id) AS latest_id, MAX(created_at), COUNT(*) FROM messages
            GROUP BY conversation_id ORDER BY latest_id DESC LIMIT ? OFFSET ?""", (limit + 1, offset)).fetchall()
        items = []
        for conversation_id, first_id, _, updated_at, count in rows[:limit]:
            title = db.execute("SELECT content FROM messages WHERE id = ?", (first_id,)).fetchone()[0]
            items.append({"id": conversation_id, "title": title[:100], "updated_at": updated_at, "messages": count})
    return {"conversations": items, "has_more": len(rows) > limit}


@app.get("/api/dashboard", dependencies=[Depends(authenticate)])
async def dashboard(request: Request):
    return await request.app.state.crons.read()


@app.get("/api/conversations/{conversation_id}", dependencies=[Depends(authenticate)])
def conversation(conversation_id: UUID):
    with database() as db:
        total = db.execute("SELECT COUNT(*) FROM messages WHERE conversation_id = ?", (str(conversation_id),)).fetchone()[0]
    return {"messages": history(conversation_id), "total": total}


@app.post("/api/chat", dependencies=[Depends(authenticate)])
async def chat(body: ChatRequest, request: Request):
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Écrire un message avant l'envoi.")
    if request.app.state.chat_lock.locked():
        raise HTTPException(409, "Un échange est déjà en cours. Attendre sa réponse.")
    async with request.app.state.chat_lock:
        messages = history(body.conversation_id, limit=20)
        if body.family_context:
            with database() as db:
                messages.insert(0, {"role": "system", "content": assistant.family_digest(db)})
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


dist = Path(os.getenv("KARL_FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist")))
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="pwa")
