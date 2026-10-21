"""Family identities never authorize the personal Hermes API."""
import base64
import hashlib
import os
import re
import secrets
import sqlite3
import time
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from .store import database

router = APIRouter(prefix="/api")
SESSION = "karl_family"
FLOW = "karl_google_flow"
MONTH = 30 * 86400


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def origin():
    value = os.getenv("KARL_PUBLIC_ORIGIN", "http://127.0.0.1:18000").rstrip("/")
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or not parsed.hostname:
        raise HTTPException(503, "Adresse de KARL à configurer côté serveur.")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise HTTPException(503, "Une adresse HTTPS est requise pour les accès familiaux.")
    return value


def same_origin(request):
    if request.headers.get("origin") != origin():
        raise HTTPException(403, "Origine de la demande refusée.")


def configured():
    return bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))


def initialize():
    with database() as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS family_members (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE,
                role TEXT NOT NULL CHECK(role IN ('admin','member')), is_owner INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1, google_sub TEXT UNIQUE);
            CREATE TABLE IF NOT EXISTS family_sessions (
                token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES family_members(id),
                csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS family_invites (
                token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES family_members(id), expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS family_oauth (
                token_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, verifier TEXT NOT NULL,
                nonce TEXT NOT NULL, expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS family_items (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity TEXT NOT NULL, category TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL REFERENCES family_members(id), updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS family_events (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
                attendees TEXT NOT NULL, driver_id TEXT REFERENCES family_members(id), location TEXT NOT NULL,
                recurrence TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES family_members(id),
                deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS family_tasks (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, assignee_id TEXT REFERENCES family_members(id), due_date TEXT,
                done INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL REFERENCES family_members(id), version INTEGER NOT NULL DEFAULT 1);
        """)
        if not db.execute("SELECT 1 FROM family_members WHERE is_owner=1").fetchone():
            db.execute("INSERT INTO family_members(id,name,role,is_owner) VALUES(?,?,'admin',1)",
                       (str(uuid4()), os.getenv("KARL_FAMILY_OWNER_NAME", "Administrateur")[:60]))
        # Additive migration: each member keeps one shape/colour slot for life, so the
        # interface never has to infer identity from list order or colour alone.
        if "badge" not in {row[1] for row in db.execute("PRAGMA table_info(family_members)")}:
            db.execute("ALTER TABLE family_members ADD COLUMN badge INTEGER")
        for row in db.execute("SELECT id FROM family_members WHERE badge IS NULL ORDER BY is_owner DESC,rowid").fetchall():
            db.execute("UPDATE family_members SET badge=? WHERE id=?", (free_badge(db), row["id"]))
        # Additive migration: an activity can ask its invitees to confirm instead of only informing them.
        if "ask" not in {row[1] for row in db.execute("PRAGMA table_info(family_events)")}:
            db.execute("ALTER TABLE family_events ADD COLUMN ask INTEGER NOT NULL DEFAULT 0")
        db.execute("""CREATE TABLE IF NOT EXISTS family_event_replies (
            event_id TEXT NOT NULL REFERENCES family_events(id), member_id TEXT NOT NULL REFERENCES family_members(id),
            answer TEXT NOT NULL CHECK(answer IN ('pending','yes','no')), answered_at TEXT, PRIMARY KEY(event_id, member_id))""")
        # Additive migration: key tasks need a parent's validation once a member reports them done.
        columns = {row[1] for row in db.execute("PRAGMA table_info(family_tasks)")}
        for column, kind in [("key_task", "INTEGER NOT NULL DEFAULT 0"), ("submitted_by", "TEXT REFERENCES family_members(id)"),
                             ("submitted_at", "TEXT"), ("validated_by", "TEXT REFERENCES family_members(id)"),
                             # Additive migration: a weekly task comes back a week later once done.
                             ("repeat", "TEXT NOT NULL DEFAULT 'none'"), ("next_id", "TEXT")]:
            if column not in columns:
                db.execute(f"ALTER TABLE family_tasks ADD COLUMN {column} {kind}")


def free_badge(db):
    used = {row[0] for row in db.execute("SELECT badge FROM family_members WHERE badge IS NOT NULL")}
    return next(slot for slot in range(len(used) + 1) if slot not in used)


def user_public(row):
    return {"id": row["id"], "name": row["name"], "role": row["role"], "is_owner": bool(row["is_owner"]), "badge": row["badge"]}


def find_session(request):
    token = request.cookies.get(SESSION, "")
    if not token or len(token) > 200:
        return None
    with database() as db:
        return db.execute("""SELECT m.*,s.csrf FROM family_sessions s JOIN family_members m ON m.id=s.member_id
            WHERE s.token_hash=? AND s.expires_at>? AND m.active=1""", (digest(token), int(time.time()))).fetchone()


def member(request: Request):
    user = find_session(request)
    if user is None:
        raise HTTPException(401, "Reconnectez-vous à l’espace famille.")
    if request.method not in ("GET", "HEAD"):
        same_origin(request)
        if not secrets.compare_digest(request.headers.get("x-csrf-token", "").encode(), user["csrf"].encode()):
            raise HTTPException(403, "Demande expirée. Rechargez KARL.")
    return user


def admin(user=Depends(member)):
    if user["role"] != "admin":
        raise HTTPException(403, "Cette action est réservée aux administrateurs de la famille.")
    return user


def issue_session(response, member_id):
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    now = int(time.time())
    with database() as db, db:
        db.execute("DELETE FROM family_sessions WHERE expires_at<=?", (now,))
        db.execute("INSERT INTO family_sessions VALUES(?,?,?,?)", (digest(token), member_id, csrf, now + MONTH))
    response.set_cookie(SESSION, token, max_age=MONTH, httponly=True, secure=origin().startswith("https://"), samesite="lax", path="/api")


def owner_login(request, response):
    same_origin(request)
    with database() as db:
        owner = db.execute("SELECT id FROM family_members WHERE is_owner=1 AND active=1").fetchone()
    if not owner:
        raise HTTPException(503, "Compte propriétaire indisponible.")
    issue_session(response, owner["id"])
    return {"ok": True}


@router.get("/auth/session")
def session(request: Request):
    user = find_session(request)
    return {"user": user_public(user) if user else None, "csrf": user["csrf"] if user else None,
            "google_enabled": configured(), "preview": os.getenv("KARL_PREVIEW", "") == "1"}


@router.post("/auth/logout")
def logout(request: Request, response: Response, user=Depends(member)):
    with database() as db, db:
        db.execute("DELETE FROM family_sessions WHERE token_hash=?", (digest(request.cookies[SESSION]),))
    response.delete_cookie(SESSION, path="/api")
    return {"ok": True}


class Invite(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=3, max_length=254)
    role: str = Field(pattern="^(admin|member)$", default="member")

    @field_validator("name")
    @classmethod
    def name_valid(cls, value):
        if not value.strip():
            raise ValueError("Un prénom est requis.")
        return value.strip()

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}", value):
            raise ValueError("Adresse e-mail invalide.")
        return value


@router.get("/family/members")
def members(user=Depends(member)):
    with database() as db:
        rows = db.execute("SELECT * FROM family_members ORDER BY is_owner DESC,name COLLATE NOCASE").fetchall()
    return {"members": [{**user_public(row), "active": bool(row["active"]), "assistant": bool(row["assistant"]),
                         **({"email": row["email"]} if user["role"] == "admin" else {})} for row in rows if row["active"] or user["role"] == "admin"]}


@router.post("/family/invitations")
def invite(body: Invite, user=Depends(admin)):
    token = secrets.token_urlsafe(32)
    with database() as db, db:
        existing = db.execute("SELECT * FROM family_members WHERE email=?", (body.email,)).fetchone()
        if existing:
            if existing["is_owner"] or not existing["active"]:
                raise HTTPException(409, "Ce compte ne peut pas recevoir cette invitation.")
            member_id = existing["id"]
            # Reissuing an invitation never changes an existing member's role.
        else:
            member_id = str(uuid4())
            db.execute("INSERT INTO family_members(id,name,email,role,badge) VALUES(?,?,?,?,?)",
                       (member_id, body.name, body.email, body.role, free_badge(db)))
        db.execute("DELETE FROM family_invites WHERE member_id=? OR expires_at<=?", (member_id, int(time.time())))
        db.execute("INSERT INTO family_invites VALUES(?,?,?)", (digest(token), member_id, int(time.time()) + 7 * 86400))
    return {"url": origin() + "/#invitation=" + token, "expires_in_days": 7}


class Accept(BaseModel):
    token: str = Field(min_length=20, max_length=100)


@router.post("/auth/invitation")
def accept(body: Accept, request: Request, response: Response):
    same_origin(request)
    with database() as db, db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("""SELECT i.member_id FROM family_invites i JOIN family_members m ON m.id=i.member_id
            WHERE i.token_hash=? AND i.expires_at>? AND m.active=1""", (digest(body.token), int(time.time()))).fetchone()
        if not row:
            raise HTTPException(401, "Invitation expirée ou déjà utilisée. Demandez un nouveau lien à un parent.")
        db.execute("DELETE FROM family_invites WHERE token_hash=?", (digest(body.token),))
    issue_session(response, row["member_id"])
    return {"ok": True}


class Access(BaseModel):
    active: bool | None = None
    assistant: bool | None = None


@router.patch("/family/members/{member_id}")
def change_access(member_id: str, body: Access, user=Depends(admin)):
    with database() as db, db:
        target = db.execute("SELECT * FROM family_members WHERE id=?", (member_id,)).fetchone()
        if not target:
            raise HTTPException(404, "Membre introuvable.")
        if body.assistant is not None:
            db.execute("UPDATE family_members SET assistant=? WHERE id=?", (body.assistant, member_id))
        if body.active is None:
            return {"ok": True}
        if target["is_owner"] or target["id"] == user["id"]:
            raise HTTPException(403, "Cet accès ne peut pas être désactivé ici.")
        db.execute("UPDATE family_members SET active=? WHERE id=?", (body.active, member_id))
        db.execute("DELETE FROM family_sessions WHERE member_id=?", (member_id,))
        db.execute("DELETE FROM family_invites WHERE member_id=?", (member_id,))
    return {"ok": True}


@router.get("/auth/google/start")
def google_start():
    if not configured():
        return RedirectResponse("/?auth_error=google_unconfigured", status_code=303)
    token, state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(4))
    now = int(time.time())
    with database() as db, db:
        db.execute("DELETE FROM family_oauth WHERE expires_at<=?", (now,))
        if db.execute("SELECT COUNT(*) FROM family_oauth").fetchone()[0] >= 100:
            raise HTTPException(429, "Trop de connexions en cours. Réessayez dans quelques minutes.")
        db.execute("INSERT INTO family_oauth VALUES(?,?,?,?,?)", (digest(token), digest(state), verifier, nonce, now + 600))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    params = {"client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": origin() + "/api/auth/google/callback",
              "response_type": "code", "scope": "openid email", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account"}
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params), status_code=303)
    response.set_cookie(FLOW, token, max_age=600, httponly=True, secure=origin().startswith("https://"), samesite="lax", path="/api/auth/google")
    return response


async def google_identity(code, flow):
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": origin() + "/api/auth/google/callback", "grant_type": "authorization_code", "code_verifier": flow["verifier"]})
        response.raise_for_status()
        token = response.json()["id_token"]
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise ValueError("Invalid signing algorithm")
        response = await client.get("https://www.googleapis.com/oauth2/v3/certs")
        response.raise_for_status()
        keys = response.json()["keys"]
        key = next((item for item in keys if item.get("kid") == header.get("kid")), None)
        if key is None:
            raise ValueError("Unknown signing key")
        claims = jwt.decode(token, jwt.PyJWK.from_dict(key).key, algorithms=["RS256"], audience=os.environ["GOOGLE_CLIENT_ID"],
                            issuer=["https://accounts.google.com", "accounts.google.com"],
                            options={"require": ["exp", "iat", "sub", "iss", "aud", "nonce", "email", "email_verified"]})
    if claims["nonce"] != flow["nonce"] or claims["email_verified"] is not True or not isinstance(claims["sub"], str):
        raise ValueError("Invalid Google identity")
    if claims.get("azp", os.environ["GOOGLE_CLIENT_ID"]) != os.environ["GOOGLE_CLIENT_ID"]:
        raise ValueError("Invalid authorized party")
    return claims


@router.get("/auth/google/callback")
async def google_callback(request: Request, state: str = "", code: str = "", error: str = ""):
    response = RedirectResponse("/?auth_error=google_denied", status_code=303)
    response.delete_cookie(FLOW, path="/api/auth/google")
    token = request.cookies.get(FLOW, "")
    if not token or not state or len(token) > 200 or len(state) > 200 or len(code) > 4096 or not configured():
        return response
    with database() as db, db:
        db.execute("BEGIN IMMEDIATE")
        flow = db.execute("SELECT * FROM family_oauth WHERE token_hash=?", (digest(token),)).fetchone()
        db.execute("DELETE FROM family_oauth WHERE token_hash=?", (digest(token),))
    if not flow or flow["expires_at"] <= time.time() or not secrets.compare_digest(flow["state_hash"], digest(state)) or error:
        return response
    try:
        claims = await google_identity(code, flow)
        email = claims["email"].strip().lower()
        with database() as db, db:
            db.execute("BEGIN IMMEDIATE")
            user = db.execute("SELECT * FROM family_members WHERE email=? AND active=1", (email,)).fetchone()
            if not user or (user["google_sub"] and user["google_sub"] != claims["sub"]):
                return RedirectResponse("/?auth_error=not_invited", status_code=303)
            db.execute("UPDATE family_members SET google_sub=? WHERE id=?", (claims["sub"], user["id"]))
        response = RedirectResponse("/", status_code=303)
        response.delete_cookie(FLOW, path="/api/auth/google")
        issue_session(response, user["id"])
        return response
    except (httpx.HTTPError, ValueError, KeyError, TypeError, StopIteration, jwt.PyJWTError, sqlite3.IntegrityError):
        return response
