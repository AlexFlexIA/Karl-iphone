"""Family assistant: one private set of threads per member, answered by a dedicated
family Hermes profile. Never falls back to the owner's personal Hermes."""
import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError

from .family import PARIS, EventInput, now, occurrences
from .family_auth import member
from .store import database

router = APIRouter(prefix="/api/family/assistant")
PROPOSAL = re.compile(r"```karl-event\s*\n(.*?)```", re.S)
WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
locks: dict[str, asyncio.Lock] = {}


class Unavailable(Exception):
    pass


def initialize():
    with database() as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS family_threads (
                id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES family_members(id),
                title TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS family_thread_messages (
                id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES family_threads(id) ON DELETE CASCADE,
                role TEXT NOT NULL, content TEXT NOT NULL, proposals TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS family_thread_messages_thread ON family_thread_messages(thread_id, id);
            CREATE INDEX IF NOT EXISTS family_threads_member ON family_threads(member_id, updated_at);
        """)
        # Additive migration: admins can switch the assistant off per member.
        if "assistant" not in {row[1] for row in db.execute("PRAGMA table_info(family_members)")}:
            db.execute("ALTER TABLE family_members ADD COLUMN assistant INTEGER NOT NULL DEFAULT 1")


def configured():
    return bool(os.getenv("HERMES_FAMILY_API_KEY"))


def daily_limit():
    try:
        return max(1, int(os.getenv("KARL_ASSISTANT_DAILY_LIMIT", "60")))
    except ValueError:
        return 60


def allowed(user=Depends(member)):
    if not user["assistant"]:
        raise HTTPException(403, "L’assistant n’est pas activé pour ce compte. Demandez à un parent.")
    return user


async def complete(messages):
    key = os.getenv("HERMES_FAMILY_API_KEY", "")
    if not key:
        raise Unavailable("L’assistant famille n’est pas encore branché sur le serveur.")
    base = os.getenv("HERMES_FAMILY_API_URL", "http://127.0.0.1:8643/v1").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                                         json={"model": os.getenv("HERMES_FAMILY_MODEL", "hermes-agent"),
                                               "messages": messages, "stream": False})
            response.raise_for_status()
            choice = response.json()["choices"][0]
            reply = choice["message"]["content"]
            if choice.get("finish_reason") != "stop" or not isinstance(reply, str) or not reply.strip():
                raise ValueError("No complete text reply")
            return reply
    except httpx.TimeoutException as exc:
        raise Unavailable("L’assistant met trop de temps à répondre. Réessayez dans un moment.") from exc
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        # Upstream bodies may hold tool output: never forwarded.
        raise Unavailable("L’assistant n’a pas pu répondre. Réessayez dans un moment.") from exc


def briefing(db, user):
    """Context KARL owns and the member may already see: date, family first names, their own agenda."""
    moment = datetime.now(PARIS)
    names = [row["name"] for row in db.execute("SELECT name FROM family_members WHERE active=1 ORDER BY is_owner DESC,name")]
    agenda = []
    for event in occurrences(db, moment.date(), moment.date() + timedelta(days=13)):
        if user["id"] in event["attendees"] or event["driver_id"] == user["id"]:
            start, end = (datetime.fromisoformat(event[key]).astimezone(PARIS) for key in ("starts_at", "ends_at"))
            agenda.append(f"- {WEEKDAYS[start.weekday()]} {start:%d/%m %H:%M}–{end:%H:%M} : {event['title']}"
                          + (f" ({event['location']})" if event["location"] else ""))
    return "\n".join([
        f"Tu es l’assistant personnel de {user['name']}, dans l’application familiale KARL.",
        f"Nous sommes le {WEEKDAYS[moment.weekday()]} {moment:%d/%m/%Y}, il est {moment:%H:%M} (heure de Paris).",
        "Membres de la famille : " + ", ".join(names) + ".",
        f"Agenda de {user['name']} pour les deux prochaines semaines :",
        *(agenda or ["- rien de prévu"]),
        "Réponds en français, simplement. Ne parle jamais des conversations d’autres membres.",
        "Pour proposer d’ajouter une activité au planning familial, termine ta réponse par un bloc :",
        "```karl-event",
        '{"title": "Piscine", "starts_at": "2026-10-21T17:00:00+02:00", "ends_at": "2026-10-21T18:00:00+02:00", "location": "", "attendees": ["'
        + user["name"] + '"]}',
        "```",
        "Un bloc par activité, trois au plus, dates ISO avec fuseau. KARL demande confirmation avant d’enregistrer ;"
        " tu n’as aucun autre moyen de modifier le planning.",
    ])


def proposals(db, user, reply):
    """Split validated event proposals out of the reply; anything malformed is dropped."""
    names = {row["name"].casefold(): row["id"] for row in db.execute("SELECT id,name FROM family_members WHERE active=1")}
    found = []
    for block in PROPOSAL.findall(reply)[:3]:
        try:
            raw = json.loads(block)
            attendees = [names[name.strip().casefold()] for name in raw.get("attendees") or [] if isinstance(name, str) and name.strip().casefold() in names]
            event = EventInput(title=raw.get("title", ""), starts_at=raw.get("starts_at"), ends_at=raw.get("ends_at"),
                               location=raw.get("location") or "", attendees=attendees or [user["id"]])
        except (ValueError, TypeError, AttributeError, ValidationError):
            continue
        found.append({"title": event.title, "starts_at": event.starts_at.isoformat(), "ends_at": event.ends_at.isoformat(),
                      "location": event.location.strip(), "attendees": event.attendees, "event_id": None})
    text = PROPOSAL.sub("", reply).strip()
    return text or ("Je propose d’ajouter ceci au planning :" if found else reply.strip()), found


def thread_for(db, thread_id, user):
    row = db.execute("SELECT * FROM family_threads WHERE id=?", (str(thread_id),)).fetchone()
    # Another member's thread is indistinguishable from a missing one.
    if row and row["member_id"] != user["id"]:
        raise HTTPException(404, "Conversation introuvable.")
    return row


def public(row):
    return {"id": row["id"], "role": row["role"], "content": row["content"], "proposals": json.loads(row["proposals"]),
            "created_at": row["created_at"]}


@router.get("")
def overview(user=Depends(member)):
    with database() as db:
        used = used_today(db, user)
        threads = db.execute("SELECT id,title,updated_at FROM family_threads WHERE member_id=? ORDER BY updated_at DESC LIMIT 50",
                             (user["id"],)).fetchall()
    return {"enabled": bool(user["assistant"]), "configured": configured(), "remaining": max(0, daily_limit() - used),
            "threads": [dict(row) for row in threads]}


def used_today(db, user):
    start = datetime.combine(datetime.now(PARIS).date(), datetime.min.time(), PARIS).astimezone(timezone.utc).isoformat()
    return db.execute("""SELECT COUNT(*) FROM family_thread_messages m JOIN family_threads t ON t.id=m.thread_id
        WHERE t.member_id=? AND m.role='user' AND m.created_at>=?""", (user["id"], start)).fetchone()[0]


@router.get("/threads/{thread_id}")
def thread(thread_id: UUID, user=Depends(allowed)):
    with database() as db:
        if not thread_for(db, thread_id, user):
            raise HTTPException(404, "Conversation introuvable.")
        rows = db.execute("SELECT * FROM family_thread_messages WHERE thread_id=? ORDER BY id DESC LIMIT 200", (str(thread_id),)).fetchall()
    return {"messages": [public(row) for row in reversed(rows)]}


@router.delete("/threads/{thread_id}")
def forget(thread_id: UUID, user=Depends(allowed)):
    with database() as db, db:
        if not thread_for(db, thread_id, user):
            raise HTTPException(404, "Conversation introuvable.")
        db.execute("DELETE FROM family_thread_messages WHERE thread_id=?", (str(thread_id),))
        db.execute("DELETE FROM family_threads WHERE id=?", (str(thread_id),))
    return {"ok": True}


class Ask(BaseModel):
    thread_id: UUID
    message: str = Field(min_length=1, max_length=4000)


@router.post("/chat")
async def chat(body: Ask, user=Depends(allowed)):
    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Écrivez un message avant l’envoi.")
    lock = locks.setdefault(user["id"], asyncio.Lock())
    if lock.locked():
        raise HTTPException(409, "Une réponse est déjà en cours. Attendez-la avant d’écrire.")
    async with lock:
        with database() as db:
            if thread_for(db, body.thread_id, user) is None and \
                    db.execute("SELECT COUNT(*) FROM family_threads WHERE member_id=?", (user["id"],)).fetchone()[0] >= 200:
                raise HTTPException(409, "Trop de conversations. Supprimez-en quelques-unes.")
            if used_today(db, user) >= daily_limit():
                raise HTTPException(429, "Limite de messages atteinte pour aujourd’hui. L’assistant revient demain.")
            history = db.execute("""SELECT role,content FROM family_thread_messages WHERE thread_id=?
                ORDER BY id DESC LIMIT 20""", (str(body.thread_id),)).fetchall()
            context = briefing(db, user)
        messages = [{"role": "system", "content": context}, *({"role": row["role"], "content": row["content"]} for row in reversed(history)),
                    {"role": "user", "content": message}]
        try:
            reply = await complete(messages)
        except Unavailable as exc:
            raise HTTPException(502, str(exc)) from exc
        with database() as db, db:
            text, found = proposals(db, user, reply)
            stamp = now()
            db.execute("""INSERT INTO family_threads(id,member_id,title,updated_at) VALUES(?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at""", (str(body.thread_id), user["id"], message[:80], stamp))
            db.execute("INSERT INTO family_thread_messages(thread_id,role,content,created_at) VALUES(?,?,?,?)",
                       (str(body.thread_id), "user", message, stamp))
            cursor = db.execute("INSERT INTO family_thread_messages(thread_id,role,content,proposals,created_at) VALUES(?,?,?,?,?)",
                                (str(body.thread_id), "assistant", text, json.dumps(found), stamp))
            row = db.execute("SELECT * FROM family_thread_messages WHERE id=?", (cursor.lastrowid,)).fetchone()
    return {"message": public(row)}


class Confirm(BaseModel):
    index: int = Field(ge=0, le=2)


@router.post("/messages/{message_id}/accept", status_code=201)
def accept(message_id: int, body: Confirm, user=Depends(allowed)):
    """The only path from a reply to the planning: an explicit tap by the member."""
    with database() as db, db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""SELECT m.*,t.member_id FROM family_thread_messages m JOIN family_threads t ON t.id=m.thread_id
            WHERE m.id=? AND m.role='assistant'""", (message_id,)).fetchone()
        if not row or row["member_id"] != user["id"]:
            raise HTTPException(404, "Proposition introuvable.")
        found = json.loads(row["proposals"])
        if body.index >= len(found):
            raise HTTPException(404, "Proposition introuvable.")
        proposal = found[body.index]
        if proposal["event_id"]:
            return {"id": proposal["event_id"]}
        event = EventInput(**{key: proposal[key] for key in ("title", "starts_at", "ends_at", "location", "attendees")})
        attendees = [value for value in event.attendees
                     if db.execute("SELECT 1 FROM family_members WHERE id=? AND active=1", (value,)).fetchone()] or [user["id"]]
        if db.execute("SELECT COUNT(*) FROM family_events WHERE deleted=0").fetchone()[0] >= 2000:
            raise HTTPException(409, "Le planning est plein. Retirez les anciens événements.")
        event_id = str(uuid4())
        db.execute("""INSERT INTO family_events(id,title,starts_at,ends_at,attendees,driver_id,location,recurrence,created_by)
            VALUES(?,?,?,?,?,NULL,?,'once',?)""", (event_id, event.title, event.starts_at.astimezone(timezone.utc).isoformat(),
                                                   event.ends_at.astimezone(timezone.utc).isoformat(), json.dumps(attendees),
                                                   event.location.strip(), user["id"]))
        proposal["event_id"] = event_id
        db.execute("UPDATE family_thread_messages SET proposals=? WHERE id=?", (json.dumps(found), message_id))
    return {"id": event_id}
