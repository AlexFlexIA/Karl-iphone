"""Family meals: recipes, a weekly menu and the shopping list they add up to.
Nothing here talks to a shop: the list is prepared in KARL and stays a list."""
import json
import re
import unicodedata
from datetime import date, timedelta
from fractions import Fraction
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from .family import now, required
from .family_auth import member
from .store import database

router = APIRouter(prefix="/api/family")
SLOTS = Literal["lunch", "dinner"]
# Units are matched on the word right after the quantity; metric ones are summed in a base unit.
UNITS = [
    (r"kg|kilos?|kilogrammes?", "kg"), (r"g|gr|grammes?", "g"),
    (r"l|litres?", "l"), (r"dl", "dl"), (r"cl", "cl"), (r"ml", "ml"),
    (r"c\.?\s*à\s*s\.?|cs|càs|cuill[eè]res?\s+à\s+soupe", "c. à s."),
    (r"c\.?\s*à\s*c\.?|cc|càc|cuill[eè]res?\s+à\s+caf[ée]", "c. à c."),
    (r"pinc[ée]es?", "pincée"), (r"gousses?", "gousse"), (r"tranches?", "tranche"), (r"bo[iî]tes?", "boîte"),
    (r"sachets?", "sachet"), (r"bottes?", "botte"), (r"pots?", "pot"), (r"briques?", "brique"), (r"paquets?", "paquet"),
    (r"bouteilles?", "bouteille"), (r"filets?", "filet"),
]
BASE = {"kg": ("g", 1000), "g": ("g", 1), "l": ("ml", 1000), "dl": ("ml", 100), "cl": ("ml", 10), "ml": ("ml", 1)}
FRACTIONS = {"½": Fraction(1, 2), "¼": Fraction(1, 4), "¾": Fraction(3, 4)}
# A small, editable guess so generated items land in a sensible aisle; anything else goes to « Autres ».
AISLES = {
    "Fruits et légumes": "pomme poire banane citron orange fraise tomate carotte courgette oignon echalote ail salade poireau "
                         "pomme de terre patate champignon poivron aubergine epinard brocoli chou concombre avocat persil "
                         "basilic coriandre ciboulette herbes legume fruit haricot courge potiron navet radis",
    "Frais": "lait beurre creme oeuf yaourt fromage gruyere emmental parmesan mozzarella feta comte jambon lardon poulet "
             "boeuf veau porc dinde steak viande saumon cabillaud poisson crevette feuilletee brisee",
    "Épicerie": "farine sucre sel poivre huile vinaigre riz pates spaghetti semoule lentille pois chiche quinoa chocolat "
                "levure miel moutarde bouillon epice cumin curry paprika thym laurier conserve sauce tomate concentre "
                "biscuit cereale cafe confiture coco amande noix",
}


def plain(value):
    value = unicodedata.normalize("NFKD", value.casefold().replace("œ", "oe").replace("æ", "ae"))
    return " ".join("".join(c for c in value if not unicodedata.combining(c)).replace("’", "'").split())


def key_of(name):
    """Singular, accent-free form so « Tomates » and « tomate » end up on one line."""
    return " ".join(word[:-1] if len(word) > 3 and word[-1] in "sx" else word for word in re.split(r"[\s\-]+", plain(name)))


def aisle_of(name):
    words = set(key_of(name).split())
    for aisle, vocabulary in AISLES.items():
        if words & {key_of(term) for term in vocabulary.split()}:
            return aisle
    return "Autres"


def number(token):
    if token in FRACTIONS:
        return FRACTIONS[token]
    if "/" in token:
        top, bottom = token.split("/")
        return Fraction(int(top), int(bottom)) if int(bottom) else None
    return Fraction(token.replace(",", "."))


def parse_line(line):
    """« 200 g de farine » → name, quantity, unit. A line without a number is kept as a plain item."""
    text = line.strip().lstrip("-•*").strip()
    if not text:
        return None
    quantity, unit, rest = None, "", text
    match = re.match(r"(\d+(?:[.,]\d+)?|\d+/\d+|[½¼¾])\s*(.*)$", text)
    if match:
        quantity, rest = number(match[1]), match[2]
        for pattern, canonical in UNITS:
            found = re.match(rf"(?:{pattern})(?=\s|$)\s*", rest, re.I)
            if found:
                unit, rest = canonical, rest[found.end():]
                break
    rest = re.sub(r"^(?:de\s+|d['’]\s*|des\s+)", "", rest, flags=re.I).strip()
    if not rest or (quantity is not None and quantity <= 0):
        raise ValueError(text)
    return {"line": text[:120], "name": rest[:120], "quantity": None if quantity is None else float(quantity),
            "unit": unit, "category": aisle_of(rest)}


def amount(value):
    rounded = round(value, 2)
    return (f"{rounded:.2f}".rstrip("0").rstrip(".")).replace(".", ",")


def label(quantity, unit):
    if quantity is None:
        return ""
    if unit == "g" and quantity >= 1000:
        quantity, unit = quantity / 1000, "kg"
    if unit == "ml" and quantity >= 1000:
        quantity, unit = quantity / 1000, "l"
    if unit and unit not in ("g", "kg", "ml", "l", "c. à s.", "c. à c.") and quantity > 1:
        unit += "s"
    return f"{amount(quantity)} {unit}".strip()


class RecipeInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    servings: int = Field(default=4, ge=1, le=30)
    ingredients: list[str] = Field(default_factory=list, max_length=60)
    notes: str = Field(default="", max_length=4000)

    _title = field_validator("title")(required)


class RecipeEdit(RecipeInput):
    version: int = Field(ge=1)


class Change(BaseModel):
    version: int = Field(ge=1)
    deleted: bool


def ingredients_of(body):
    parsed = []
    for index, line in enumerate(body.ingredients, 1):
        try:
            item = parse_line(line)
        except (ValueError, ZeroDivisionError, ArithmeticError):
            raise HTTPException(422, f"Ingrédient {index} illisible : écrivez par exemple « 200 g de farine ».")
        if item:
            parsed.append(item)
    return parsed


def recipe_public(row):
    return {**dict(row), "ingredients": json.loads(row["ingredients"])}


def owned(row, user, what):
    if row["created_by"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, f"Seul l’auteur ou un parent peut modifier {what}.")


@router.get("/recipes")
def recipes(user=Depends(member)):
    with database() as db:
        rows = db.execute("SELECT * FROM family_recipes WHERE deleted=0 ORDER BY title COLLATE NOCASE LIMIT 500").fetchall()
    return {"recipes": [recipe_public(row) for row in rows]}


@router.post("/recipes", status_code=201)
def add_recipe(body: RecipeInput, user=Depends(member)):
    recipe_id = str(uuid4())
    parsed = ingredients_of(body)
    with database() as db, db:
        if db.execute("SELECT COUNT(*) FROM family_recipes WHERE deleted=0").fetchone()[0] >= 500:
            raise HTTPException(409, "Le carnet de recettes est plein. Retirez d’anciennes recettes.")
        db.execute("INSERT INTO family_recipes(id,title,servings,ingredients,notes,created_by,updated_at) VALUES(?,?,?,?,?,?,?)",
                   (recipe_id, body.title, body.servings, json.dumps(parsed, ensure_ascii=False), body.notes.strip(), user["id"], now()))
    return {"id": recipe_id}


@router.put("/recipes/{recipe_id}")
def edit_recipe(recipe_id: str, body: RecipeEdit, user=Depends(member)):
    parsed = ingredients_of(body)
    with database() as db, db:
        row = db.execute("SELECT * FROM family_recipes WHERE id=? AND deleted=0", (recipe_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Recette introuvable.")
        owned(row, user, "cette recette")
        cursor = db.execute("""UPDATE family_recipes SET title=?,servings=?,ingredients=?,notes=?,updated_at=?,version=version+1
            WHERE id=? AND version=?""", (body.title, body.servings, json.dumps(parsed, ensure_ascii=False), body.notes.strip(), now(),
                                         recipe_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cette recette a changé sur un autre appareil. Actualisez puis réessayez.")
    return {"ok": True}


@router.patch("/recipes/{recipe_id}")
def remove_recipe(recipe_id: str, body: Change, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_recipes WHERE id=?", (recipe_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Recette introuvable.")
        owned(row, user, "cette recette")
        cursor = db.execute("UPDATE family_recipes SET deleted=?,version=version+1 WHERE id=? AND version=?", (body.deleted, recipe_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Cette recette a changé. Actualisez puis réessayez.")
    return {"ok": True}


class MealInput(BaseModel):
    day: date
    slot: SLOTS = "dinner"
    recipe_id: str | None = Field(default=None, max_length=80)
    title: str = Field(default="", max_length=120)
    servings: int = Field(default=4, ge=1, le=30)


def window(first, last):
    if not 0 <= (last - first).days <= 62:
        raise HTTPException(422, "Choisissez une période de 63 jours maximum.")


def planned(db, first, last):
    return db.execute("""SELECT m.*,COALESCE(r.title,m.title) AS label,r.servings AS recipe_servings,r.ingredients,r.deleted AS recipe_deleted
        FROM family_meals m LEFT JOIN family_recipes r ON r.id=m.recipe_id
        WHERE m.deleted=0 AND m.day BETWEEN ? AND ? ORDER BY m.day,m.slot DESC,m.rowid LIMIT 500""",
                      (first.isoformat(), last.isoformat())).fetchall()


@router.get("/meals")
def meals(first: date, last: date, user=Depends(member)):
    window(first, last)
    with database() as db:
        rows = planned(db, first, last)
    return {"meals": [{key: row[key] for key in ("id", "day", "slot", "recipe_id", "servings", "created_by", "version")}
                      | {"title": row["label"], "has_recipe": bool(row["recipe_id"] and row["ingredients"] and not row["recipe_deleted"])}
                      for row in rows]}


@router.post("/meals", status_code=201)
def add_meal(body: MealInput, user=Depends(member)):
    meal_id = str(uuid4())
    with database() as db, db:
        title = body.title.strip()
        if body.recipe_id:
            recipe = db.execute("SELECT title FROM family_recipes WHERE id=? AND deleted=0", (body.recipe_id,)).fetchone()
            if not recipe:
                raise HTTPException(422, "Cette recette n’existe plus. Choisissez-en une autre.")
            title = recipe["title"]
        if not title:
            raise HTTPException(422, "Choisissez une recette ou écrivez le nom du repas.")
        if db.execute("SELECT COUNT(*) FROM family_meals WHERE deleted=0 AND day=?", (body.day.isoformat(),)).fetchone()[0] >= 12:
            raise HTTPException(409, "Ce jour compte déjà beaucoup de repas. Retirez-en un.")
        db.execute("INSERT INTO family_meals(id,day,slot,recipe_id,title,servings,created_by) VALUES(?,?,?,?,?,?,?)",
                   (meal_id, body.day.isoformat(), body.slot, body.recipe_id, title, body.servings, user["id"]))
    return {"id": meal_id}


@router.patch("/meals/{meal_id}")
def remove_meal(meal_id: str, body: Change, user=Depends(member)):
    with database() as db, db:
        row = db.execute("SELECT * FROM family_meals WHERE id=?", (meal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Repas introuvable.")
        owned(row, user, "ce repas")
        cursor = db.execute("UPDATE family_meals SET deleted=?,version=version+1 WHERE id=? AND version=?", (body.deleted, meal_id, body.version))
        if cursor.rowcount != 1:
            raise HTTPException(409, "Ce repas a changé. Actualisez puis réessayez.")
    return {"ok": True}


class Copy(BaseModel):
    source: date
    target: date


@router.post("/meals/copy", status_code=201)
def copy_week(body: Copy, user=Depends(member)):
    """Repeats a week's menu on another week; a slot that already has a dish is left alone."""
    if abs((body.target - body.source).days) < 7:
        raise HTTPException(422, "Choisissez deux semaines différentes.")
    shift = body.target - body.source
    with database() as db, db:
        db.execute("BEGIN IMMEDIATE")
        taken = {(row["day"], row["slot"]) for row in planned(db, body.target, body.target + timedelta(days=6))}
        copied = [(str(uuid4()), (date.fromisoformat(row["day"]) + shift).isoformat(), row["slot"],
                   row["recipe_id"] if row["recipe_id"] and not row["recipe_deleted"] else None, row["label"], row["servings"], user["id"])
                  for row in planned(db, body.source, body.source + timedelta(days=6))
                  if ((date.fromisoformat(row["day"]) + shift).isoformat(), row["slot"]) not in taken]
        db.executemany("INSERT INTO family_meals(id,day,slot,recipe_id,title,servings,created_by) VALUES(?,?,?,?,?,?,?)", copied)
    return {"copied": len(copied)}


def needs(db, first, last):
    """Ingredients of every planned meal, scaled to its portions, summed per product and unit,
    and compared with what is still unticked on the shared list."""
    lines, without = {}, 0
    for meal in planned(db, first, last):
        if not meal["recipe_id"] or not meal["ingredients"] or meal["recipe_deleted"]:
            without += 1
            continue
        factor = meal["servings"] / (meal["recipe_servings"] or 1)
        for item in json.loads(meal["ingredients"]):
            key = key_of(item["name"])
            line = lines.setdefault(key, {"key": key, "name": item["name"], "category": item["category"], "amounts": {}, "sources": []})
            if meal["label"] not in line["sources"]:
                line["sources"].append(meal["label"])
            if item["quantity"] is None:
                line["amounts"].setdefault("", None)
                continue
            unit, scale = BASE.get(item["unit"], (item["unit"], 1))
            previous = line["amounts"].get(unit) or 0
            line["amounts"][unit] = previous + item["quantity"] * scale * factor
    listed = {}
    for row in db.execute("SELECT name,quantity FROM family_items WHERE deleted=0 AND checked=0"):
        listed.setdefault(key_of(row["name"]), row["quantity"] or "sur la liste")
    result = []
    for line in sorted(lines.values(), key=lambda value: (value["category"], plain(value["name"]))):
        parts = [label(quantity, unit) for unit, quantity in line["amounts"].items()]
        result.append({"key": line["key"], "name": line["name"][:1].upper() + line["name"][1:], "category": line["category"],
                       "quantity": " + ".join(part for part in parts if part)[:60], "sources": line["sources"],
                       "on_list": listed.get(line["key"])})
    return result, without


@router.get("/meals/shopping")
def shopping_preview(first: date, last: date, user=Depends(member)):
    window(first, last)
    with database() as db:
        lines, without = needs(db, first, last)
    return {"lines": lines, "without_recipe": without}


class Generate(BaseModel):
    first: date
    last: date
    keys: list[str] = Field(max_length=300)


@router.post("/meals/shopping", status_code=201)
def generate(body: Generate, user=Depends(member)):
    """Adds only the chosen lines, and never one that is already unticked on the list."""
    window(body.first, body.last)
    wanted = set(body.keys)
    with database() as db, db:
        db.execute("BEGIN IMMEDIATE")
        lines, _ = needs(db, body.first, body.last)
        chosen = [line for line in lines if line["key"] in wanted and not line["on_list"]]
        count = db.execute("SELECT COUNT(*) FROM family_items WHERE deleted=0").fetchone()[0]
        if count + len(chosen) > 2000:
            raise HTTPException(409, "La liste est pleine. Retirez les anciens articles.")
        stamp = now()
        db.executemany("INSERT INTO family_items(id,name,quantity,category,updated_by,updated_at) VALUES(?,?,?,?,?,?)",
                       [(str(uuid4()), line["name"], line["quantity"], line["category"], user["id"], stamp) for line in chosen])
    return {"added": len(chosen), "skipped": len([line for line in lines if line["key"] in wanted]) - len(chosen)}


def initialize():
    with database() as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS family_recipes (
                id TEXT PRIMARY KEY, title TEXT NOT NULL, servings INTEGER NOT NULL, ingredients TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES family_members(id),
                deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS family_meals (
                id TEXT PRIMARY KEY, day TEXT NOT NULL, slot TEXT NOT NULL CHECK(slot IN ('lunch','dinner')),
                recipe_id TEXT REFERENCES family_recipes(id), title TEXT NOT NULL, servings INTEGER NOT NULL,
                created_by TEXT NOT NULL REFERENCES family_members(id),
                deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1);
            CREATE INDEX IF NOT EXISTS family_meals_day ON family_meals(day);
        """)
