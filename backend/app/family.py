"""Small shared household organizer. No dependency on Hermes or Telegram."""
import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field, field_validator, model_validator

from .family_auth import Invite, member
from .store import database

router = APIRouter(prefix="/api/family")
PARIS = ZoneInfo("Europe/Paris")
CATEGORIES = Literal["Autres", "Fruits et légumes", "Frais", "Épicerie", "Maison"]


def now():
    return datetime.now(timezone.utc).isoformat()


def active_ids(db, values):
    for value in values:
        if value and not db.execute("SELECT 1 FROM family_members WHERE id=? AND active=1", (value,)).fetchone():
            raise HTTPException(422, "Choisissez un membre actif de la famille.")


def required(value):
    value = value.strip()
    if not value:
        raise ValueError("Ce champ ne peut pas être vide.")
    return value


@router.patch("/profile")
def owner_profile(body: Invite, user=Depends(member)):
    if not user["is_owner"]:
        raise HTTPException(403, "Le propriétaire gère son adresse depuis cet écran.")
    with database() as db, db:
        existing = db.execute("SELECT id FROM family_members WHERE email=? AND id<>?", (body.email, user["id"])).fetchone()
        if existing:
            raise HTTPException(409, "Cette adresse est déjà utilisée par un membre.")
        db.execute("UPDATE family_members SET name=?,email=?,google_sub=CASE WHEN email=? THEN google_sub ELSE NULL END WHERE id=?",
                   (body.name, body.email, body.email, user["id"]))
    return {"ok": True}


class ItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    quantity: str = Field(default="", max_length=60)
    category: CATEGORIES = "Autres"

    _name = field_validator("name")(required)


class ItemChange(BaseModel):
    version: int = Field(ge=1)
    checked: bool | None = None
    deleted: bool | None = None


@router.get("/items")
def items(user=Depends(member)):
    with database() as db:
        rows = db.execute("""SELECT i.*,m.name AS author FROM family_items i
            JOIN family_members m ON m.id=i.updated_by WHERE deleted=0
            ORDER BY checked,category,updated_at DESC LIMIT 2000""").fetchall()
    return {"items": [dict(row) for row in rows]}


@router.post("/items", status_code=201)
def add_item(body: ItemInput, user=Depends(member)):
    item_id = str(uuid4())
    with database() as db, db:
        if db.execute("SELECT COUNT(*) FROM family_items WHERE deleted=0").fetchone()[0] >= 2000:
            raise HTTPException(409, "La liste est pleine. Retirez les anciens articles.")
        db.execute("INSERT INTO family_items(id,name,quantity,category,updated_by,updated_at) VALUES(?,?,?,?,?,?)",
                   (item_id, body.name, body.quantity.strip(), body.category, user["id"], now()))
    return {"id": item_id}


@router.patch("/items/{item_id}")
def update_item(item_id: str, body: ItemChange, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Article introuvable.")
        cursor = db.execute("""UPDATE family_items SET checked=?,deleted=?,version=version+1,updated_by=?,updated_at=?
            WHERE id=? AND version=?""", (row["checked"] if body.checked is None else body.checked,
                                         row["deleted"] if body.deleted is None else body.deleted,
                                         user["id"], now(), item_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cet article a changé sur un autre appareil. La liste a été actualisée ; réessayez.")
    return {"ok": True}


class EventInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    starts_at: datetime
    ends_at: datetime
    attendees: list[str] = Field(default_factory=list, max_length=20)
    driver_id: str | None = Field(default=None, max_length=80)
    location: str = Field(default="", max_length=160)
    recurrence: Literal["once", "weekly"] = "once"

    _title = field_validator("title")(required)

    @model_validator(mode="after")
    def valid_dates(self):
        if not self.starts_at.tzinfo or not self.ends_at.tzinfo:
            raise ValueError("Un fuseau horaire est requis.")
        if self.ends_at <= self.starts_at or self.ends_at - self.starts_at > timedelta(days=7):
            raise ValueError("La fin doit suivre le début, dans une limite de sept jours.")
        self.attendees = list(dict.fromkeys(self.attendees))
        return self


class EventChange(BaseModel):
    version: int = Field(ge=1)
    deleted: bool


class EventEdit(EventInput):
    version: int = Field(ge=1)


def occurrences(db, first, last):
    start = datetime.combine(first, datetime.min.time(), PARIS)
    end = datetime.combine(last + timedelta(days=1), datetime.min.time(), PARIS)
    rows = db.execute("SELECT * FROM family_events WHERE deleted=0 ORDER BY starts_at LIMIT 2000").fetchall()
    result = []
    for row in rows:
        beginning = datetime.fromisoformat(row["starts_at"]).astimezone(PARIS)
        ending = datetime.fromisoformat(row["ends_at"]).astimezone(PARIS)
        weekly = row["recurrence"] == "weekly"
        if weekly and beginning < start:
            # Jump near the window without iterating years of past occurrences.
            weeks = max(0, (start.date() - beginning.date()).days // 7 - 1)
            beginning += timedelta(weeks=weeks)
            ending += timedelta(weeks=weeks)
        for _ in range(12 if weekly else 1):
            if beginning >= end:
                break
            if ending > start:
                item = dict(row)
                item.update(starts_at=beginning.isoformat(), ends_at=ending.isoformat(),
                            series_starts_at=row["starts_at"], series_ends_at=row["ends_at"], attendees=json.loads(row["attendees"]))
                result.append(item)
            if not weekly:
                break
            beginning += timedelta(weeks=1)
            ending += timedelta(weeks=1)
    return sorted(result, key=lambda event: datetime.fromisoformat(event["starts_at"]))


@router.get("/events")
def events(first: date, last: date, user=Depends(member)):
    if not 0 <= (last - first).days <= 62:
        raise HTTPException(422, "Choisissez une période de 63 jours maximum.")
    with database() as db:
        return {"events": occurrences(db, first, last)}


@router.post("/events", status_code=201)
def add_event(body: EventInput, user=Depends(member)):
    event_id = str(uuid4())
    with database() as db, db:
        active_ids(db, [*body.attendees, body.driver_id])
        if db.execute("SELECT COUNT(*) FROM family_events WHERE deleted=0").fetchone()[0] >= 2000:
            raise HTTPException(409, "Le planning est plein. Retirez les anciens événements.")
        db.execute("""INSERT INTO family_events(id,title,starts_at,ends_at,attendees,driver_id,location,recurrence,created_by)
            VALUES(?,?,?,?,?,?,?,?,?)""", (event_id, body.title, body.starts_at.astimezone(timezone.utc).isoformat(),
                                           body.ends_at.astimezone(timezone.utc).isoformat(), json.dumps(body.attendees),
                                           body.driver_id, body.location.strip(), body.recurrence, user["id"]))
    return {"id": event_id}


@router.patch("/events/{event_id}")
def update_event(event_id: str, body: EventChange, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_events WHERE id=?", (event_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Événement introuvable.")
        if row["created_by"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "Seul l’auteur ou un parent peut retirer cet événement.")
        cursor = db.execute("UPDATE family_events SET deleted=?,version=version+1 WHERE id=? AND version=?",
                            (body.deleted, event_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cet événement a changé. Actualisez le planning.")
    return {"ok": True}


@router.put("/events/{event_id}")
def edit_event(event_id: str, body: EventEdit, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_events WHERE id=? AND deleted=0", (event_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Événement introuvable.")
        if row["created_by"] != user["id"] and user["role"] != "admin":
            raise HTTPException(403, "Seul l’auteur ou un parent peut modifier cet événement.")
        active_ids(db, [*body.attendees, body.driver_id])
        cursor = db.execute("""UPDATE family_events SET title=?,starts_at=?,ends_at=?,attendees=?,driver_id=?,location=?,recurrence=?,
            version=version+1 WHERE id=? AND version=?""", (body.title, body.starts_at.astimezone(timezone.utc).isoformat(),
                body.ends_at.astimezone(timezone.utc).isoformat(), json.dumps(body.attendees), body.driver_id,
                body.location.strip(), body.recurrence, event_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cet événement a changé sur un autre appareil. Actualisez le planning.")
    return {"ok": True}


class TaskInput(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    assignee_id: str | None = Field(default=None, max_length=80)
    due_date: date | None = None
    key_task: bool = False

    _title = field_validator("title")(required)


class TaskChange(BaseModel):
    version: int = Field(ge=1)
    done: bool | None = None
    deleted: bool | None = None
    review: Literal["approve", "reject"] | None = None


@router.get("/tasks")
def tasks(user=Depends(member)):
    with database() as db:
        return {"tasks": [dict(row) for row in db.execute("SELECT * FROM family_tasks WHERE deleted=0 ORDER BY done,due_date IS NULL,due_date,title LIMIT 2000")]}


@router.post("/tasks", status_code=201)
def add_task(body: TaskInput, user=Depends(member)):
    task_id = str(uuid4())
    with database() as db, db:
        if body.key_task and user["role"] != "admin":
            raise HTTPException(403, "Seul un parent peut créer une tâche clé.")
        active_ids(db, [body.assignee_id])
        if db.execute("SELECT COUNT(*) FROM family_tasks WHERE deleted=0").fetchone()[0] >= 2000:
            raise HTTPException(409, "La liste est pleine. Retirez les anciennes tâches.")
        db.execute("INSERT INTO family_tasks(id,title,assignee_id,due_date,created_by,key_task) VALUES(?,?,?,?,?,?)",
                   (task_id, body.title, body.assignee_id, body.due_date.isoformat() if body.due_date else None, user["id"], body.key_task))
    return {"id": task_id}


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, body: TaskChange, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Tâche introuvable.")
        if body.deleted is not None and user["role"] != "admin" and row["created_by"] != user["id"]:
            raise HTTPException(403, "Seul l’auteur ou un parent peut retirer cette tâche.")
        parent = user["role"] == "admin"
        state = {key: row[key] for key in ("done", "deleted", "submitted_by", "submitted_at", "validated_by")}
        if body.deleted is not None:
            state["deleted"] = body.deleted
        if body.review is not None:
            # A key task reported done waits for a parent: approve closes it, reject sends it back.
            if not parent:
                raise HTTPException(403, "Seul un parent peut valider une tâche clé.")
            if not row["key_task"] or row["done"] or not row["submitted_by"]:
                raise HTTPException(409, "Cette tâche n’attend pas de validation. Actualisez la liste.")
            if body.review == "approve":
                state.update(done=1, validated_by=user["id"])
            else:
                state.update(submitted_by=None, submitted_at=None)
        elif body.done is not None and row["key_task"] and not parent:
            if row["done"]:
                raise HTTPException(403, "Cette tâche clé a été validée par un parent.")
            state.update(submitted_by=user["id"] if body.done else None, submitted_at=now() if body.done else None)
        elif body.done is not None:
            state.update(done=body.done, validated_by=user["id"] if body.done and row["key_task"] else None)
            if not body.done:
                state.update(submitted_by=None, submitted_at=None)
        cursor = db.execute("""UPDATE family_tasks SET done=?,deleted=?,submitted_by=?,submitted_at=?,validated_by=?,version=version+1
            WHERE id=? AND version=?""", (state["done"], state["deleted"], state["submitted_by"], state["submitted_at"],
                                          state["validated_by"], task_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cette tâche a changé sur un autre appareil. Actualisez la liste.")
    return {"ok": True}


def ical_text(value):
    return value.replace("\\", "\\\\").replace("\r", "").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def ical_line(value):
    # RFC 5545 folds at 75 octets without splitting UTF-8 characters.
    lines, current = [], ""
    for character in value:
        if len((current + character).encode()) > 75:
            lines.append(current)
            current = " "
        current += character
    return "\r\n".join([*lines, current])


@router.get("/calendar.ics")
def calendar_export(user=Depends(member)):
    first = datetime.now(PARIS).date()
    with database() as db:
        data = occurrences(db, first, first + timedelta(days=62))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KARL//Famille//FR", "CALSCALE:GREGORIAN"]
    for event in data:
        def utc(value):
            return datetime.fromisoformat(value).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        lines.extend(["BEGIN:VEVENT", "UID:" + event["id"] + "-" + utc(event["starts_at"]) + "@karl",
                      "DTSTAMP:" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
                      "DTSTART:" + utc(event["starts_at"]), "DTEND:" + utc(event["ends_at"]),
                      "SUMMARY:" + ical_text(event["title"]), "LOCATION:" + ical_text(event["location"]), "END:VEVENT"])
    lines.append("END:VCALENDAR")
    return Response("\r\n".join(ical_line(line) for line in lines) + "\r\n", media_type="text/calendar",
                    headers={"Content-Disposition": 'attachment; filename="karl-famille.ics"'})
