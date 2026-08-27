from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
import re

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, field_validator, model_validator
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, timedelta, date
from bson import ObjectId
import logging
import time
import base64
import io
import secrets
import bcrypt
import jwt
from collections import defaultdict
from PIL import Image

# ---------------------------------------------------------------------------
# DB & App setup
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

app = FastAPI(title="Resto Control API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("resto")

# ---------------------------------------------------------------------------
# Mongo helpers
# ---------------------------------------------------------------------------
def _validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    return str(v)

PyObjectId = Annotated[str, BeforeValidator(_validate_object_id)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        if not doc:
            return None
        return cls(**doc)

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat()


def serialize(doc: dict) -> dict:
    """Convert a raw mongo doc into a JSON-safe dict (id as str)."""
    if not doc:
        return doc
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


def parse_oid(v: str) -> ObjectId:
    if not ObjectId.is_valid(v):
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return ObjectId(v)


# --- simple in-memory brute-force protection ---
_login_attempts = defaultdict(list)
LOCK_THRESHOLD = 5
LOCK_WINDOW = 900  # 15 minutes


def check_lock(key: str):
    now = time.time()
    attempts = [t for t in _login_attempts[key] if now - t < LOCK_WINDOW]
    _login_attempts[key] = attempts
    if len(attempts) >= LOCK_THRESHOLD:
        raise HTTPException(status_code=429, detail="Слишком много попыток. Повторите через 15 минут.")


def record_fail(key: str):
    _login_attempts[key].append(time.time())


# глобальный троттлинг подбора PIN (per-PIN бакет не ловит перебор разных PIN)
_pin_global = []
PIN_GLOBAL_WINDOW = 300
PIN_GLOBAL_MAX = 40


def pin_global_guard():
    now = time.time()
    global _pin_global
    _pin_global = [t for t in _pin_global if now - t < PIN_GLOBAL_WINDOW]
    if len(_pin_global) >= PIN_GLOBAL_MAX:
        raise HTTPException(status_code=429, detail="Слишком много неверных попыток. Попробуйте позже.")


def record_pin_global():
    _pin_global.append(time.time())


def clear_fails(key: str):
    _login_attempts.pop(key, None)


# ---------------------------------------------------------------------------
# Auth utils
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, role: str, restaurant_id: Optional[str] = None) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "rid": restaurant_id,
        "exp": now_utc() + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


# --- Мультитенантность: дефолтное заведение (restaurant_id) ---
_default_rid_cache: Optional[str] = None


async def get_default_rid() -> Optional[str]:
    global _default_rid_cache
    if _default_rid_cache:
        return _default_rid_cache
    r = await db.restaurants.find_one({"is_default": True}) or await db.restaurants.find_one({})
    _default_rid_cache = str(r["_id"]) if r else None
    return _default_rid_cache


async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Не авторизован")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Пользователь не найден")
        user = serialize(user)
        user.pop("password_hash", None)
        user["restaurant_id"] = user.get("restaurant_id") or payload.get("rid") or await get_default_rid()
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Срок действия сессии истёк")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Неверный токен")


def require_roles(*roles):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        return user
    return checker


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------
class LoginReq(BaseModel):
    email: str
    password: str


class PinLoginReq(BaseModel):
    pin: str


class RestaurantReq(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None


class WorkshopReq(BaseModel):
    name: str
    color: Optional[str] = "#00E5FF"


class WarehouseReq(BaseModel):
    name: str
    workshop_id: Optional[str] = None


class CategoryReq(BaseModel):
    name: str
    color: Optional[str] = "#FF5A00"
    position: int = 0
    course_number: int = 0  # курс подачи (0 = без курса)


class RecipeIngredient(BaseModel):
    inventory_id: str
    name: str
    amount: float
    unit: Optional[str] = None  # единица, в которой задан amount (kg/g/l/ml/pcs); None = единица склада
    processing_method: Optional[str] = None  # cold | boil | fry | stew | bake


class ModifierGroupReq(BaseModel):
    name: str
    selection_type: str = "single"  # single | multiple
    min_count: int = 0
    max_count: int = 1

    @field_validator("selection_type")
    @classmethod
    def _valid_type(cls, v):
        if v not in ("single", "multiple"):
            raise ValueError("selection_type must be 'single' or 'multiple'")
        return v


class ModifierOptionReq(BaseModel):
    name: str
    price_delta: float = 0.0
    inventory_id: Optional[str] = None
    amount: Optional[float] = None


class ProductReq(BaseModel):
    name: str
    category_id: Optional[str] = None
    workshop_id: Optional[str] = None
    price: float = 0.0
    cost: float = 0.0
    cost_source: str = "manual"  # auto | manual
    measure: str = "pcs"
    image: Optional[str] = None
    for_sale: bool = True
    recipe: List[RecipeIngredient] = []
    modifier_group_ids: List[str] = []
    yield_g: Optional[float] = None
    preparation_notes: Optional[str] = ""
    course_number: Optional[int] = None  # переопределяет курс подачи категории


class TableReq(BaseModel):
    name: str
    hall: str = "Основной зал"
    seats: int = 4


class StaffReq(BaseModel):
    name: str
    role: str  # waiter | admin | manager
    pin: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None

    @field_validator("role")
    @classmethod
    def _check_role(cls, v):
        if v not in ("waiter", "admin", "manager"):
            raise ValueError("role должен быть waiter, admin или manager")
        return v


class SelectedModifier(BaseModel):
    group_id: str
    option_id: str
    name: str
    price_delta: float = 0.0


class OrderItemReq(BaseModel):
    product_id: str
    name: str
    price: float
    count: float = 1
    workshop_id: Optional[str] = None
    print_status: str = "pending"
    print_job_id: Optional[str] = None
    selected_modifiers: List[SelectedModifier] = []
    course_number: Optional[int] = None
    comment: Optional[str] = None


class OrderCreateReq(BaseModel):
    table_id: Optional[str] = None
    client_id: Optional[str] = None
    items: List[OrderItemReq] = []


class OrderUpdateReq(BaseModel):
    items: List[OrderItemReq]
    client_id: Optional[str] = None


class PaymentReq(BaseModel):
    payment_method: str = "cash"  # cash | card
    discount: float = 0.0
    client_id: Optional[str] = None
    discount_source: Optional[str] = None
    bonus_redeem_amount: float = 0.0


class SupplierReq(BaseModel):
    name: str
    phone: Optional[str] = ""


class ClientReq(BaseModel):
    name: str
    phone: str
    discount_percent: float = 0.0
    loyalty_group_id: Optional[str] = None


class RefundItemReq(BaseModel):
    index: int
    qty: float = 1


class RefundReq(BaseModel):
    items: List[RefundItemReq] = []
    reason: str = ""


class ServiceChargeReq(BaseModel):
    service_charge_percent: float = 0.0
    service_charge_default_enabled: bool = False


class ToggleReq(BaseModel):
    enabled: bool


class ReservationReq(BaseModel):
    table_id: Optional[str] = None
    hall: Optional[str] = None
    date: str
    time_from: str
    time_to: Optional[str] = None
    guest_name: str
    guest_phone: Optional[str] = ""
    guests_count: int = 1
    deposit_amount: float = 0.0


class ReservationPatchReq(BaseModel):
    status: Optional[str] = None
    deposit_amount: Optional[float] = None
    table_id: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v):
        if v is not None and v not in ("pending", "confirmed", "seated", "cancelled", "done"):
            raise ValueError("invalid status")
        return v


class BonusAdjustReq(BaseModel):
    amount: float
    note: Optional[str] = ""


class LoyaltyGroupReq(BaseModel):
    name: str
    type: str = "bonus"  # bonus | discount
    value_percent: float = 0.0

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v):
        if v not in ("bonus", "discount"):
            raise ValueError("type must be 'bonus' or 'discount'")
        return v


class PromotionReq(BaseModel):
    name: str
    active: bool = True
    weekdays: List[int] = []  # 0=Mon..6=Sun; [] = все дни
    time_from: Optional[str] = None  # HH:MM
    time_to: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    condition_items: List[dict] = []  # [{product_id?, category_id?, min_qty}]
    result_type: str = "discount_percent"  # discount_percent | free_item | bonus_item
    result_value: float = 0.0
    result_product_id: Optional[str] = None  # для free_item/bonus_item
    auto_apply: bool = True
    stackable: bool = False

    @field_validator("result_type")
    @classmethod
    def _valid_result(cls, v):
        if v not in ("discount_percent", "free_item", "bonus_item"):
            raise ValueError("invalid result_type")
        return v

    @field_validator("weekdays")
    @classmethod
    def _valid_weekdays(cls, v):
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("weekdays must be 0..6")
        return v


class InventoryItemReq(BaseModel):
    name: str
    measure: str = "kg"
    balance: float = 0.0
    cost: float = 0.0
    warehouse_id: Optional[str] = None  # склад для начального остатка (по умолчанию — дефолтный)
    processing_loss: Optional[dict] = None  # {"cold":5,"boil":10,"fry":15,"stew":8,"bake":12} (%)


class InvoiceItemReq(BaseModel):
    inventory_id: str
    name: str
    amount: float
    price: float


class InvoiceReq(BaseModel):
    number: str
    warehouse_id: Optional[str] = None  # склад прихода (по умолчанию — дефолтный)
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    items: List[InvoiceItemReq] = []


class WriteOffReq(BaseModel):
    inventory_id: str
    amount: float
    reason: str = "Списание"
    warehouse_id: Optional[str] = None  # склад списания (по умолчанию — дефолтный)


class StockTransferReq(BaseModel):
    inventory_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    amount: float


class PrinterReq(BaseModel):
    name: str
    station: str  # kitchen | bar | precheck
    workshop_id: Optional[str] = None
    local_ip: str = "192.168.0.100"
    port: int = 9100
    codepage_label: str = "cp866"          # iconv/python codec name, e.g. cp866
    escape_t_value: int = 17               # ESC t <n> — задаётся вручную под каждый принтер
    paper_width_mm: int = 80
    active: bool = True

    @field_validator("codepage_label")
    @classmethod
    def _check_codepage(cls, v):
        if v not in ("cp866", "cp1251"):
            raise ValueError("codepage_label должен быть cp866 или cp1251")
        return v

    @field_validator("escape_t_value")
    @classmethod
    def _check_esct(cls, v):
        if not (0 <= v <= 255):
            raise ValueError("escape_t_value должен быть 0..255")
        return v


class AgentReq(BaseModel):
    name: str


class JobReport(BaseModel):
    status: str  # printed | failed
    error_message: Optional[str] = None


class HeartbeatReq(BaseModel):
    printers: Optional[dict] = None  # {printer_id: "online"|"offline"}


class MoveReq(BaseModel):
    table_id: Optional[str] = None


class VoidItemReq(BaseModel):
    reason: Optional[str] = None
    confirm_pin: Optional[str] = None


class PrintTextReq(BaseModel):
    text: str


class PrintImageReq(BaseModel):
    image: str  # data URL или чистый base64


class LogoReq(BaseModel):
    image: Optional[str] = None
    enabled: Optional[bool] = None


class ReceiptSettingsReq(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    footer_note: Optional[str] = None
    max_bonus_payment_percent: Optional[float] = None
    service_charge_percent: Optional[float] = None
    service_charge_default_enabled: Optional[bool] = None


class SplitReq(BaseModel):
    indices: List[int]


class QuickCommentReq(BaseModel):
    text: str
    context: str = "order"  # order | dish | cancel

    @field_validator("context")
    @classmethod
    def _valid_ctx(cls, v):
        if v not in ("order", "dish", "cancel"):
            raise ValueError("context must be order, dish or cancel")
        return v


class CashMovementReq(BaseModel):
    type: str  # in | out
    amount: float
    reason: str = ""

    @field_validator("type")
    @classmethod
    def _valid_move_type(cls, v):
        if v not in ("in", "out"):
            raise ValueError("type must be 'in' or 'out'")
        return v


class CancelOrderReq(BaseModel):
    reason: str = ""


class PaymentMethodReq(BaseModel):
    name: str
    code: str
    is_debt: bool = False
    active: bool = True
    position: int = 0


class PayDebtReq(BaseModel):
    amount: float
    payment_method: str = "cash"


# ---------------------------------------------------------------------------
# AUTH ROUTES
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def login(req: LoginReq, request: Request):
    email = req.email.strip().lower()
    key = f"login:{email}"
    user = await db.users.find_one({"email": email})
    if user and verify_password(req.password, user.get("password_hash", "")):
        clear_fails(key)  # валидный вход никогда не блокируется
        token = create_token(str(user["_id"]), user["role"], user.get("restaurant_id"))
        u = serialize(user)
        u.pop("password_hash", None)
        return {"token": token, "user": u}
    record_fail(key)
    check_lock(key)
    raise HTTPException(status_code=401, detail="Неверный email или пароль")


@api.post("/auth/pin-login")
async def pin_login(req: PinLoginReq, request: Request):
    pin = req.pin.strip()
    key = f"pin:{pin}"
    user = await db.users.find_one({"pin": pin})
    if user:
        clear_fails(key)
        token = create_token(str(user["_id"]), user["role"], user.get("restaurant_id"))
        u = serialize(user)
        u.pop("password_hash", None)
        return {"token": token, "user": u}
    record_fail(key)
    record_pin_global()
    check_lock(key)
    pin_global_guard()
    raise HTTPException(status_code=401, detail="Неверный PIN-код")


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Generic CRUD helpers
# ---------------------------------------------------------------------------
async def list_docs(coll, query=None, sort=None, rid=None):
    q = dict(query or {})
    if rid is not None:
        q["restaurant_id"] = rid
    cursor = db[coll].find(q)
    if sort:
        cursor = cursor.sort(sort)
    docs = await cursor.to_list(2000)
    return [serialize(d) for d in docs]


# ---------------------------------------------------------------------------
# Склад: помощники для остатков по складам и себестоимости (Задача 2)
# ---------------------------------------------------------------------------
async def default_warehouse_id(rid) -> Optional[str]:
    w = (await db.warehouses.find_one({"restaurant_id": rid, "is_default": True})
         or await db.warehouses.find_one({"restaurant_id": rid}))
    return str(w["_id"]) if w else None


async def warehouse_for_workshop(rid, workshop_id) -> Optional[str]:
    if workshop_id:
        w = await db.warehouses.find_one({"restaurant_id": rid, "workshop_id": workshop_id})
        if w:
            return str(w["_id"])
    return await default_warehouse_id(rid)


async def resolve_warehouse(rid, warehouse_id) -> str:
    """Валидирует склад в рамках заведения; пустой -> дефолтный. 404 если чужой/несуществующий."""
    if not warehouse_id:
        wid = await default_warehouse_id(rid)
        if not wid:
            raise HTTPException(status_code=400, detail="Не настроен склад по умолчанию")
        return wid
    w = await db.warehouses.find_one({"_id": parse_oid(warehouse_id), "restaurant_id": rid})
    if not w:
        raise HTTPException(status_code=404, detail="Склад не найден")
    return warehouse_id


async def adjust_stock(rid, inventory_id, warehouse_id, delta):
    """Двигает остаток на конкретном складе и синхронизирует агрегат inventory.balance."""
    if not warehouse_id:
        warehouse_id = await default_warehouse_id(rid)
    await db.stock.update_one(
        {"restaurant_id": rid, "inventory_id": inventory_id, "warehouse_id": warehouse_id},
        {"$inc": {"quantity": delta}}, upsert=True)
    await db.inventory.update_one(
        {"_id": parse_oid(inventory_id), "restaurant_id": rid}, {"$inc": {"balance": delta}})


async def get_stock_qty(rid, inventory_id, warehouse_id) -> float:
    s = await db.stock.find_one(
        {"restaurant_id": rid, "inventory_id": inventory_id, "warehouse_id": warehouse_id})
    return round(s.get("quantity", 0), 4) if s else 0.0


async def compute_product_cost(rid, recipe) -> float:
    total = 0.0
    for ing in (recipe or []):
        if not ObjectId.is_valid(ing.get("inventory_id", "")):
            continue
        inv = await db.inventory.find_one(
            {"_id": ObjectId(ing["inventory_id"]), "restaurant_id": rid})
        if not inv:
            continue
        stock_unit = inv.get("measure", "kg")
        per = convert_amount(ing["amount"], ing.get("unit"), stock_unit)
        total += per * inv.get("cost", 0)
    return round(total, 2)


async def recompute_products_for_ingredients(rid, inventory_ids):
    prods = await db.products.find(
        {"restaurant_id": rid, "cost_source": "auto",
         "recipe.inventory_id": {"$in": list(inventory_ids)}}).to_list(3000)
    for p in prods:
        c = await compute_product_cost(rid, p.get("recipe", []))
        await db.products.update_one({"_id": p["_id"]}, {"$set": {"cost": c}})


def _to_grams(amount, unit):
    u = (unit or "").lower()
    if u in ("kg", "l"):
        return amount * 1000
    if u in ("g", "ml"):
        return amount
    return 0.0


async def compute_yield_g(rid, recipe):
    total = 0.0
    for ing in recipe or []:
        if not ObjectId.is_valid(ing.get("inventory_id", "")):
            continue
        inv = await db.inventory.find_one({"_id": ObjectId(ing["inventory_id"]), "restaurant_id": rid})
        loss = 0.0
        m = ing.get("processing_method")
        if m and inv and inv.get("processing_loss"):
            loss = inv["processing_loss"].get(m, 0) or 0
        grams = _to_grams(ing["amount"], ing.get("unit") or (inv.get("measure") if inv else None))
        total += grams * (1 - loss / 100)
    return round(total, 1) if total > 0 else None


def promo_is_active(p, when):
    if not p.get("active"):
        return False
    if p.get("weekdays") and when.weekday() not in p["weekdays"]:
        return False
    d = when.date().isoformat()
    if p.get("date_from") and d < p["date_from"]:
        return False
    if p.get("date_to") and d > p["date_to"]:
        return False
    t = when.strftime("%H:%M")
    tf, tt = p.get("time_from"), p.get("time_to")
    if tf and tt:
        if tf <= tt:
            if not (tf <= t <= tt):
                return False
        else:  # окно через полночь (напр. 22:00–02:00)
            if not (t >= tf or t <= tt):
                return False
    elif tf and t < tf:
        return False
    elif tt and t > tt:
        return False
    return True


def promo_conditions_met(p, items, prod_cat):
    for c in (p.get("condition_items") or []):
        need = c.get("min_qty", 1)
        got = 0
        for it in items:
            pid = it.get("product_id")
            if c.get("product_id") and pid == c["product_id"]:
                got += it["count"]
            elif c.get("category_id") and prod_cat.get(pid) == c["category_id"]:
                got += it["count"]
        if got < need:
            return False
    return True



# ----- Restaurants (Мультитенантность) -----
@api.get("/restaurants")
async def get_restaurants(user: dict = Depends(get_current_user)):
    return await list_docs("restaurants", sort=[("name", 1)])


@api.get("/restaurants/current")
async def current_restaurant(user: dict = Depends(get_current_user)):
    r = await db.restaurants.find_one({"_id": parse_oid(user["restaurant_id"])}) if user.get("restaurant_id") else None
    return serialize(r) if r else None


@api.post("/restaurants/switch/{target_rid}")
async def switch_restaurant(target_rid: str, user: dict = Depends(require_roles("manager"))):
    r = await db.restaurants.find_one({"_id": parse_oid(target_rid)})
    if not r:
        raise HTTPException(status_code=404, detail="Заведение не найдено")
    token = create_token(user["id"], user["role"], target_rid)
    return {"token": token, "restaurant_id": target_rid, "restaurant_name": r.get("name")}


@api.post("/restaurants")
async def create_restaurant(req: RestaurantReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "is_default": False, "created_at": iso(now_utc())}
    res = await db.restaurants.insert_one(doc)
    rid = str(res.inserted_id)
    # Сид справочников для нового заведения (Задачи 12/14)
    await db.payment_methods.insert_many([
        {"name": "Наличные", "code": "cash", "is_debt": False, "active": True, "position": 1, "restaurant_id": rid, "created_at": iso(now_utc())},
        {"name": "Карта", "code": "card", "is_debt": False, "active": True, "position": 2, "restaurant_id": rid, "created_at": iso(now_utc())},
        {"name": "В долг", "code": "debt", "is_debt": True, "active": True, "position": 3, "restaurant_id": rid, "created_at": iso(now_utc())},
    ])
    await db.quick_comments.insert_many([
        {"context": ctx, "text": txt, "restaurant_id": rid, "created_at": iso(now_utc())}
        for ctx, txt in [("dish", "Без соли"), ("dish", "Острое"), ("dish", "Без лука"),
                         ("order", "Приборы отдельно"), ("order", "Подать сразу"),
                         ("cancel", "Гость ушёл"), ("cancel", "Ошибка официанта")]
    ])
    return serialize(await db.restaurants.find_one({"_id": res.inserted_id}))


# ----- Workshops (Цеха) -----
@api.get("/workshops")
async def get_workshops(user: dict = Depends(get_current_user)):
    return await list_docs("workshops", rid=user["restaurant_id"])


@api.post("/workshops")
async def create_workshop(req: WorkshopReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.workshops.insert_one(doc)
    return serialize(await db.workshops.find_one({"_id": res.inserted_id}))


@api.put("/workshops/{wid}")
async def update_workshop(wid: str, req: WorkshopReq, user: dict = Depends(require_roles("manager"))):
    await db.workshops.update_one({"_id": parse_oid(wid), "restaurant_id": user["restaurant_id"]}, {"$set": req.model_dump()})
    return serialize(await db.workshops.find_one({"_id": parse_oid(wid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/workshops/{wid}")
async def delete_workshop(wid: str, user: dict = Depends(require_roles("manager"))):
    await db.workshops.delete_one({"_id": parse_oid(wid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Categories -----
@api.get("/categories")
async def get_categories(user: dict = Depends(get_current_user)):
    return await list_docs("categories", sort=[("position", 1)], rid=user["restaurant_id"])


@api.post("/categories")
async def create_category(req: CategoryReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.categories.insert_one(doc)
    return serialize(await db.categories.find_one({"_id": res.inserted_id}))


@api.put("/categories/{cid}")
async def update_category(cid: str, req: CategoryReq, user: dict = Depends(require_roles("manager"))):
    await db.categories.update_one({"_id": parse_oid(cid), "restaurant_id": user["restaurant_id"]}, {"$set": req.model_dump()})
    return serialize(await db.categories.find_one({"_id": parse_oid(cid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(require_roles("manager"))):
    await db.categories.delete_one({"_id": parse_oid(cid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Products -----
@api.get("/products")
async def get_products(user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    products = await list_docs("products", sort=[("name", 1)], rid=rid)
    stopped = {s["product_id"] for s in await db.stop_list.find({"restaurant_id": rid}).to_list(2000)}
    cats = {c["id"]: c for c in await list_docs("categories", rid=rid)}
    for p in products:
        p["is_available"] = p["id"] not in stopped
        cn = p.get("course_number")
        if not cn:
            cn = cats.get(p.get("category_id"), {}).get("course_number") or 0
        p["course_number"] = cn
    return products


@api.post("/products")
async def create_product(req: ProductReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    doc = {**req.model_dump(), "restaurant_id": rid, "created_at": iso(now_utc())}
    if doc.get("cost_source") == "auto":
        doc["cost"] = await compute_product_cost(rid, doc.get("recipe", []))
    if req.yield_g is None:
        doc["yield_g"] = await compute_yield_g(rid, doc.get("recipe", []))
    res = await db.products.insert_one(doc)
    return serialize(await db.products.find_one({"_id": res.inserted_id}))


@api.put("/products/{pid}")
async def update_product(pid: str, req: ProductReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    upd = req.model_dump()
    if upd.get("cost_source") == "auto":
        upd["cost"] = await compute_product_cost(rid, upd.get("recipe", []))
    if req.yield_g is None:
        upd["yield_g"] = await compute_yield_g(rid, upd.get("recipe", []))
    await db.products.update_one({"_id": parse_oid(pid), "restaurant_id": rid}, {"$set": upd})
    return serialize(await db.products.find_one({"_id": parse_oid(pid), "restaurant_id": rid}))


@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_roles("manager"))):
    await db.products.delete_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Modifier groups & options (Модификаторы, Задача 3) -----
@api.get("/modifier-groups")
async def get_modifier_groups(user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    groups = await list_docs("modifier_groups", sort=[("name", 1)], rid=rid)
    opts = await db.modifier_options.find({"restaurant_id": rid}).to_list(5000)
    by_group = {}
    for o in opts:
        by_group.setdefault(o["group_id"], []).append(serialize(o))
    for g in groups:
        g["options"] = by_group.get(g["id"], [])
    return groups


@api.post("/modifier-groups")
async def create_modifier_group(req: ModifierGroupReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.modifier_groups.insert_one(doc)
    return serialize(await db.modifier_groups.find_one({"_id": res.inserted_id}))


@api.put("/modifier-groups/{gid}")
async def update_modifier_group(gid: str, req: ModifierGroupReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    grp = await db.modifier_groups.find_one({"_id": parse_oid(gid), "restaurant_id": rid})
    if not grp:
        raise HTTPException(status_code=404, detail="Группа модификаторов не найдена")
    await db.modifier_groups.update_one({"_id": parse_oid(gid), "restaurant_id": rid}, {"$set": req.model_dump()})
    return serialize(await db.modifier_groups.find_one({"_id": parse_oid(gid), "restaurant_id": rid}))


@api.delete("/modifier-groups/{gid}")
async def delete_modifier_group(gid: str, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    await db.modifier_groups.delete_one({"_id": parse_oid(gid), "restaurant_id": rid})
    await db.modifier_options.delete_many({"group_id": gid, "restaurant_id": rid})
    # отвязать от блюд
    await db.products.update_many(
        {"restaurant_id": rid, "modifier_group_ids": gid}, {"$pull": {"modifier_group_ids": gid}})
    return {"success": True}


@api.post("/modifier-groups/{gid}/options")
async def create_modifier_option(gid: str, req: ModifierOptionReq, user: dict = Depends(require_roles("manager"))):
    grp = await db.modifier_groups.find_one({"_id": parse_oid(gid), "restaurant_id": user["restaurant_id"]})
    if not grp:
        raise HTTPException(status_code=404, detail="Группа модификаторов не найдена")
    doc = {**req.model_dump(), "group_id": gid, "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.modifier_options.insert_one(doc)
    return serialize(await db.modifier_options.find_one({"_id": res.inserted_id}))


@api.put("/modifier-groups/{gid}/options/{oid}")
async def update_modifier_option(gid: str, oid: str, req: ModifierOptionReq, user: dict = Depends(require_roles("manager"))):
    await db.modifier_options.update_one(
        {"_id": parse_oid(oid), "group_id": gid, "restaurant_id": user["restaurant_id"]},
        {"$set": req.model_dump()})
    return serialize(await db.modifier_options.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/modifier-groups/{gid}/options/{oid}")
async def delete_modifier_option(gid: str, oid: str, user: dict = Depends(require_roles("manager"))):
    await db.modifier_options.delete_one(
        {"_id": parse_oid(oid), "group_id": gid, "restaurant_id": user["restaurant_id"]})
    return {"success": True}



# ----- Tables -----
@api.get("/tables")
async def get_tables(user: dict = Depends(get_current_user)):
    tables = await list_docs("tables", sort=[("name", 1)], rid=user["restaurant_id"])
    open_orders = await db.orders.find({"status": {"$in": ["open", "sent"]}, "restaurant_id": user["restaurant_id"]}).to_list(2000)
    by_table = {}
    for o in open_orders:
        if o.get("table_id"):
            by_table.setdefault(o["table_id"], []).append(serialize(o))
    for t in tables:
        orders = by_table.get(t["id"], [])
        t["open_orders"] = orders
        t["open_order"] = orders[0] if orders else None
        t["open_total"] = round(sum(o.get("total", 0) for o in orders), 2)
    return tables


@api.post("/tables")
async def create_table(req: TableReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.tables.insert_one(doc)
    return serialize(await db.tables.find_one({"_id": res.inserted_id}))


@api.put("/tables/{tid}")
async def update_table(tid: str, req: TableReq, user: dict = Depends(require_roles("manager"))):
    await db.tables.update_one({"_id": parse_oid(tid), "restaurant_id": user["restaurant_id"]}, {"$set": req.model_dump()})
    return serialize(await db.tables.find_one({"_id": parse_oid(tid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/tables/{tid}")
async def delete_table(tid: str, user: dict = Depends(require_roles("manager"))):
    await db.tables.delete_one({"_id": parse_oid(tid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Staff -----
@api.get("/staff")
async def get_staff(user: dict = Depends(require_roles("manager"))):
    users = await db.users.find({"restaurant_id": user["restaurant_id"]}).to_list(2000)
    out = []
    for u in users:
        u = serialize(u)
        u.pop("password_hash", None)
        out.append(u)
    return out


@api.post("/staff")
async def create_staff(req: StaffReq, user: dict = Depends(require_roles("manager"))):
    doc = {"name": req.name, "role": req.role, "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    if req.role in ("waiter", "admin"):
        if not req.pin:
            raise HTTPException(status_code=400, detail="PIN обязателен для официанта/администратора")
        if await db.users.find_one({"pin": req.pin}):
            raise HTTPException(status_code=400, detail="Такой PIN уже используется")
        doc["pin"] = req.pin
    if req.role == "manager":
        if not req.email or not req.password:
            raise HTTPException(status_code=400, detail="Email и пароль обязательны для менеджера")
        doc["email"] = req.email.strip().lower()
        doc["password_hash"] = hash_password(req.password)
    res = await db.users.insert_one(doc)
    u = serialize(await db.users.find_one({"_id": res.inserted_id}))
    u.pop("password_hash", None)
    return u


@api.put("/staff/{sid}")
async def update_staff(sid: str, req: StaffReq, user: dict = Depends(require_roles("manager"))):
    target = await db.users.find_one({"_id": parse_oid(sid), "restaurant_id": user["restaurant_id"]})
    if not target:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    setd = {"name": req.name, "role": req.role}
    unsetd = {}
    if req.role == "manager":
        email = req.email or target.get("email")
        if not email or not (req.password or target.get("password_hash")):
            raise HTTPException(status_code=400, detail="Email и пароль обязательны для менеджера")
        setd["email"] = email.strip().lower()
        if req.password:
            setd["password_hash"] = hash_password(req.password)
        unsetd["pin"] = ""
    else:
        pin = req.pin or target.get("pin")
        if not pin:
            raise HTTPException(status_code=400, detail="PIN обязателен для официанта/администратора")
        if req.pin:
            dup = await db.users.find_one({"pin": req.pin, "_id": {"$ne": parse_oid(sid)}})
            if dup:
                raise HTTPException(status_code=400, detail="Такой PIN уже используется")
        setd["pin"] = pin
        unsetd["email"] = ""
        unsetd["password_hash"] = ""
    ops = {"$set": setd}
    if unsetd:
        ops["$unset"] = unsetd
    await db.users.update_one({"_id": parse_oid(sid), "restaurant_id": user["restaurant_id"]}, ops)
    u = serialize(await db.users.find_one({"_id": parse_oid(sid), "restaurant_id": user["restaurant_id"]}))
    u.pop("password_hash", None)
    return u


@api.delete("/staff/{sid}")
async def delete_staff(sid: str, user: dict = Depends(require_roles("manager"))):
    if sid == user["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    await db.users.delete_one({"_id": parse_oid(sid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ---------------------------------------------------------------------------
# SHIFTS (Смены)
# ---------------------------------------------------------------------------
@api.get("/shifts/current")
async def current_shift(user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open", "restaurant_id": user["restaurant_id"]})
    return serialize(shift) if shift else None


@api.post("/shifts/open")
async def open_shift(user: dict = Depends(require_roles("admin"))):
    existing = await db.shifts.find_one({"status": "open", "restaurant_id": user["restaurant_id"]})
    if existing:
        return serialize(existing)
    # новая смена — очистить стоп-лист прошлой смены (Задача 13)
    await db.stop_list.delete_many({"restaurant_id": user["restaurant_id"]})
    doc = {
        "status": "open",
        "restaurant_id": user["restaurant_id"],
        "opened_by": user["id"],
        "opened_by_name": user.get("name", ""),
        "opened_at": iso(now_utc()),
    }
    res = await db.shifts.insert_one(doc)
    return serialize(await db.shifts.find_one({"_id": res.inserted_id}))


@api.post("/shifts/close")
async def close_shift(user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open", "restaurant_id": user["restaurant_id"]})
    if not shift:
        raise HTTPException(status_code=400, detail="Нет открытой смены")
    open_count = await db.orders.count_documents({"status": {"$in": ["open", "sent"]}, "shift_id": str(shift["_id"])})
    if open_count > 0:
        raise HTTPException(status_code=400, detail=f"Есть незакрытые заказы ({open_count}). Оплатите или отмените их перед закрытием смены.")
    orders = await db.orders.find({"shift_id": str(shift["_id"]), "status": "closed"}).to_list(5000)
    total = sum(o.get("total", 0) for o in orders if not o.get("is_debt"))
    cash = sum(o.get("total", 0) for o in orders if o.get("payment_method") == "cash" and not o.get("is_debt"))
    card = sum(o.get("total", 0) for o in orders if o.get("payment_method") == "card" and not o.get("is_debt"))
    debt = sum(o.get("total", 0) for o in orders if o.get("is_debt"))
    totals_by_method = {}
    for o in orders:
        if o.get("is_debt"):
            continue
        pm = o.get("payment_method", "cash")
        totals_by_method[pm] = round(totals_by_method.get(pm, 0) + o.get("total", 0), 2)
    movements = await db.cash_movements.find({"shift_id": str(shift["_id"]), "restaurant_id": user["restaurant_id"]}).to_list(2000)
    cash_in = sum(m.get("amount", 0) for m in movements if m.get("type") == "in")
    cash_out = sum(m.get("amount", 0) for m in movements if m.get("type") == "out")
    expected_cash = round(cash + cash_in - cash_out, 2)
    await db.shifts.update_one(
        {"_id": shift["_id"]},
        {"$set": {
            "status": "closed",
            "closed_by": user["id"],
            "closed_at": iso(now_utc()),
            "total_sales": round(total, 2),
            "total_cash": round(cash, 2),
            "total_card": round(card, 2),
            "total_debt": round(debt, 2),
            "totals_by_method": totals_by_method,
            "cash_in": round(cash_in, 2),
            "cash_out": round(cash_out, 2),
            "expected_cash": expected_cash,
            "orders_count": len(orders),
        }},
    )
    result = serialize(await db.shifts.find_one({"_id": shift["_id"]}))
    result["movements"] = [serialize(m) for m in movements]
    return result


@api.get("/shifts")
async def list_shifts(user: dict = Depends(require_roles("manager"))):
    return await list_docs("shifts", sort=[("opened_at", -1)], rid=user["restaurant_id"])


# ---------------------------------------------------------------------------
# ORDERS
# ---------------------------------------------------------------------------
def calc_items(items: List[dict]):
    for it in items:
        mods = sum(m.get("price_delta", 0) for m in it.get("selected_modifiers", []) or [])
        it["total"] = round((it["price"] + mods) * it["count"], 2)
    subtotal = round(sum(it["total"] for it in items), 2)
    return items, subtotal


async def validate_and_price_items(rid, items):
    """Резолвит модификаторы из БД (цена/название), валидирует принадлежность блюду и min/max,
    считает итоги. Клиентские price_delta/name НЕ доверяются."""
    grp_cache = {}
    for it in items:
        pid = it.get("product_id")
        prod = await db.products.find_one({"_id": parse_oid(pid), "restaurant_id": rid}) if ObjectId.is_valid(pid or "") else None
        allowed = set((prod or {}).get("modifier_group_ids", []))
        cleaned = []
        per_group = {}
        for m in (it.get("selected_modifiers", []) or []):
            gid, oid = m.get("group_id"), m.get("option_id")
            if gid not in allowed:
                raise HTTPException(status_code=400, detail="Недопустимый модификатор для этого блюда")
            opt = await db.modifier_options.find_one(
                {"_id": parse_oid(oid), "group_id": gid, "restaurant_id": rid}) if ObjectId.is_valid(oid or "") else None
            if not opt:
                raise HTTPException(status_code=400, detail="Модификатор не найден")
            cleaned.append({"group_id": gid, "option_id": oid,
                            "name": opt["name"], "price_delta": opt.get("price_delta", 0)})
            per_group[gid] = per_group.get(gid, 0) + 1
        for gid in allowed:
            if gid not in grp_cache:
                grp_cache[gid] = await db.modifier_groups.find_one(
                    {"_id": parse_oid(gid), "restaurant_id": rid})
            grp = grp_cache[gid]
            if not grp:
                continue
            cnt = per_group.get(gid, 0)
            mx = grp.get("max_count", 1) if grp.get("selection_type") == "multiple" else 1
            mn = grp.get("min_count", 0)
            if cnt > mx:
                raise HTTPException(status_code=400, detail=f"Слишком много опций в «{grp['name']}» (макс {mx})")
            if cnt < mn:
                raise HTTPException(status_code=400, detail=f"Нужно выбрать минимум {mn} в «{grp['name']}»")
        it["selected_modifiers"] = cleaned
        mods = sum(m["price_delta"] for m in cleaned)
        it["total"] = round((it["price"] + mods) * it["count"], 2)
    subtotal = round(sum(it["total"] for it in items), 2)
    return items, subtotal


@api.get("/orders")
async def get_orders(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if status:
        q["status"] = status
    return await list_docs("orders", q, sort=[("created_at", -1)], rid=user["restaurant_id"])


@api.get("/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return serialize(o)


@api.post("/orders")
async def create_order(req: OrderCreateReq, user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open", "restaurant_id": user["restaurant_id"]})
    if not shift:
        raise HTTPException(status_code=400, detail="Смена не открыта. Откройте смену.")
    items = [i.model_dump() for i in req.items]
    items, subtotal = await validate_and_price_items(user["restaurant_id"], items)
    doc = {
        "table_id": req.table_id,
        "restaurant_id": user["restaurant_id"],
        "client_id": req.client_id,
        "waiter_id": user["id"],
        "waiter_name": user.get("name", ""),
        "items": items,
        "subtotal": subtotal,
        "discount": 0.0,
        "total": subtotal,
        "status": "open",
        "shift_id": str(shift["_id"]),
        "created_at": iso(now_utc()),
    }
    res = await db.orders.insert_one(doc)
    return serialize(await db.orders.find_one({"_id": res.inserted_id}))


@api.put("/orders/{oid}")
async def update_order(oid: str, req: OrderUpdateReq, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    items = [i.model_dump() for i in req.items]
    items, subtotal = await validate_and_price_items(user["restaurant_id"], items)
    total = round(subtotal - o.get("discount", 0), 2)
    upd = {"items": items, "subtotal": subtotal, "total": total}
    if req.client_id is not None:
        upd["client_id"] = req.client_id
    await db.orders.update_one(
        {"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]},
        {"$set": upd},
    )
    return serialize(await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]}))


@api.post("/orders/{oid}/send")
async def send_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    items = o["items"]
    pending_idx = [i for i, it in enumerate(items) if it.get("print_status", "pending") != "printed"]
    workshops = {w["id"]: w for w in await list_docs("workshops", rid=user["restaurant_id"])}
    groups = {}
    for i in pending_idx:
        wid = items[i].get("workshop_id") or "none"
        cn = items[i].get("course_number") or 0
        groups.setdefault((wid, cn), []).append(i)
    tickets = []
    jobs = []
    for (wid, cn), idxs in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        grp_items = [items[i] for i in idxs]
        wname = workshops.get(wid, {}).get("name", "Без цеха")
        tickets.append({
            "workshop": wname,
            "course_number": cn,
            "items": [{"name": items[i]["name"], "count": items[i]["count"], "comment": items[i].get("comment")} for i in idxs],
        })
        printer = await db.printers.find_one({"workshop_id": wid, "active": True, "restaurant_id": o.get("restaurant_id")}) if wid != "none" else None
        if printer:
            job = await make_job(o, printer, "ticket", grp_items)
            jobs.append(job)
            for i in idxs:
                items[i]["print_job_id"] = job["id"]
        for i in idxs:
            items[i]["print_status"] = "printed"
    await db.orders.update_one(
        {"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]},
        {"$set": {"items": items, "status": "sent", "sent_at": iso(now_utc())}},
    )
    return {"success": True, "tickets": tickets, "jobs": jobs}


@api.post("/orders/{oid}/pay")
async def pay_order(oid: str, req: PaymentReq, user: dict = Depends(require_roles("admin"))):
    rid = user["restaurant_id"]
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": rid})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже оплачен")
    subtotal = o.get("subtotal", 0) or 0

    # --- Акции: авто-применение к заказу ---
    items = list(o.get("items", []))
    prods = await db.products.find({"restaurant_id": rid}).to_list(3000)
    prod_cat = {str(p["_id"]): p.get("category_id") for p in prods}
    prod_name = {str(p["_id"]): p.get("name") for p in prods}
    now = now_utc()
    applied_promotions = []
    promo_discount = 0.0
    promos = await db.promotions.find({"restaurant_id": rid, "active": True, "auto_apply": True}).to_list(500)
    promos = [p for p in promos if promo_is_active(p, now) and promo_conditions_met(p, items, prod_cat)]
    for p in promos:
        if applied_promotions and not p.get("stackable"):
            break
        if p.get("result_type") == "discount_percent":
            amt = round(subtotal * (p.get("result_value", 0)) / 100, 2)
            promo_discount += amt
            applied_promotions.append({"promotion_id": str(p["_id"]), "name": p["name"], "discount_amount": amt})
        elif p.get("result_type") in ("free_item", "bonus_item"):
            fpid = p.get("result_product_id")
            fname = prod_name.get(fpid, p["name"])
            items.append({"product_id": fpid, "name": f"{fname} (акция)", "price": 0.0,
                          "count": 1, "workshop_id": None, "print_status": "pending",
                          "selected_modifiers": [], "total": 0.0})
            applied_promotions.append({"promotion_id": str(p["_id"]), "name": p["name"], "discount_amount": 0.0})

    total = round(subtotal - req.discount - promo_discount, 2)
    discount_percent = round(req.discount / subtotal * 100, 2) if subtotal else 0.0
    client_id = req.client_id or o.get("client_id")
    client_name = ""
    discount_source = req.discount_source
    cl = None
    if client_id:
        cl = await db.clients.find_one({"_id": parse_oid(client_id), "restaurant_id": rid})
        if cl:
            client_name = cl.get("name", "")
            if not discount_source and req.discount > 0:
                discount_source = f"client:{client_name}"
    if not discount_source and req.discount > 0:
        discount_source = "manual"

    # --- Бонусы: списание ---
    bonus_redeemed = 0.0
    if req.bonus_redeem_amount and cl:
        settings = await db.settings.find_one({"key": "venue"}) or {}
        max_pct = settings.get("max_bonus_payment_percent") or 50
        cap = round(total * max_pct / 100, 2)
        bonus_redeemed = round(min(req.bonus_redeem_amount, cl.get("bonus_balance", 0) or 0, cap), 2)
        if bonus_redeemed < 0:
            bonus_redeemed = 0.0
    total = round(total - bonus_redeemed, 2)
    if total < 0:
        total = 0.0

    # --- Сервисный сбор (Задача 10) ---
    venue = await db.settings.find_one({"key": "venue"}) or {}
    sc_pct = venue.get("service_charge_percent", 0) or 0
    sc_enabled = o.get("is_service_charge_enabled")
    if sc_enabled is None:
        sc_enabled = venue.get("service_charge_default_enabled", False)
    service_charge_amount = round(subtotal * sc_pct / 100, 2) if sc_enabled else 0.0
    total = round(total + service_charge_amount, 2)

    # --- Предоплата/депозит брони (Задача 11) ---
    prepaid = o.get("prepaid_amount", 0) or 0
    total = round(max(0, total - prepaid), 2)

    # --- Способ оплаты / оплата в долг (Задача 14) ---
    pm_doc = await db.payment_methods.find_one({"restaurant_id": rid, "code": req.payment_method})
    if not pm_doc:
        raise HTTPException(status_code=400, detail="Неизвестный способ оплаты")
    if not pm_doc.get("active", True):
        raise HTTPException(status_code=400, detail="Способ оплаты отключён")
    is_debt = bool(pm_doc.get("is_debt"))
    if is_debt and not cl:
        raise HTTPException(status_code=400, detail="Для оплаты в долг выберите клиента")

    await db.orders.update_one(
        {"_id": parse_oid(oid), "restaurant_id": rid},
        {"$set": {
            "status": "closed",
            "items": items,
            "discount": req.discount,
            "discount_percent": discount_percent,
            "discount_source": discount_source,
            "promo_discount": round(promo_discount, 2),
            "applied_promotions": applied_promotions,
            "bonus_redeemed": bonus_redeemed,
            "service_charge_amount": service_charge_amount,
            "prepaid_amount": prepaid,
            "client_id": client_id,
            "client_name": client_name,
            "total": total,
            "payment_method": req.payment_method,
            "is_debt": is_debt,
            "cashier_id": user["id"],
            "cashier_name": user.get("name", ""),
            "closed_at": iso(now_utc()),
        }},
    )

    # --- Оплата в долг: увеличение задолженности клиента ---
    if is_debt and cl:
        new_debt = round((cl.get("debt_balance", 0) or 0) + total, 2)
        await db.clients.update_one(
            {"_id": parse_oid(client_id), "restaurant_id": rid}, {"$set": {"debt_balance": new_debt}})
        await db.debt_transactions.insert_one({
            "client_id": client_id, "order_id": oid, "type": "charge", "amount": total,
            "balance_after": new_debt, "payment_method": req.payment_method,
            "staff_id": user["id"], "restaurant_id": rid, "created_at": iso(now_utc())})

    # --- Бонусы: транзакции списания и начисления (кэшбэк) ---
    if cl:
        bal = cl.get("bonus_balance", 0) or 0
        if bonus_redeemed > 0:
            bal = round(bal - bonus_redeemed, 2)
            await db.loyalty_transactions.insert_one({
                "client_id": client_id, "order_id": oid, "type": "redemption",
                "amount": bonus_redeemed, "balance_after": bal, "staff_id": user["id"],
                "restaurant_id": rid, "created_at": iso(now_utc())})
        lg = await db.loyalty_groups.find_one(
            {"_id": parse_oid(cl["loyalty_group_id"]), "restaurant_id": rid}) if cl.get("loyalty_group_id") else None
        if lg and lg.get("type") == "bonus" and lg.get("value_percent") and not is_debt:
            cashback = round(total * lg["value_percent"] / 100, 2)
            if cashback > 0:
                bal = round(bal + cashback, 2)
                await db.loyalty_transactions.insert_one({
                    "client_id": client_id, "order_id": oid, "type": "accrual",
                    "amount": cashback, "balance_after": bal, "staff_id": user["id"],
                    "restaurant_id": rid, "created_at": iso(now_utc())})
        await db.clients.update_one({"_id": parse_oid(client_id), "restaurant_id": rid}, {"$set": {"bonus_balance": bal}})

    # auto write-off ingredients by recipe (тех.карты) — со склада цеха блюда
    for it in o["items"]:
        pid = it.get("product_id", "")
        if not ObjectId.is_valid(pid):
            continue
        prod = await db.products.find_one({"_id": ObjectId(pid), "restaurant_id": rid})
        if not prod:
            continue
        wh_id = await warehouse_for_workshop(rid, prod.get("workshop_id"))
        for ing in prod.get("recipe", []):
            if not ObjectId.is_valid(ing["inventory_id"]):
                continue
            inv = await db.inventory.find_one({"_id": ObjectId(ing["inventory_id"]), "restaurant_id": rid})
            stock_unit = inv.get("measure", "kg") if inv else "kg"
            per_portion = convert_amount(ing["amount"], ing.get("unit"), stock_unit)
            amt = round(per_portion * it["count"], 4)
            if amt <= 0:
                continue
            await adjust_stock(rid, ing["inventory_id"], wh_id, -amt)
            await db.writeoffs.insert_one({
                "inventory_id": ing["inventory_id"], "name": ing["name"], "amount": amt,
                "restaurant_id": rid, "warehouse_id": wh_id, "kind": "sale",
                "reason": f"Продажа: {it['name']}", "created_by": user.get("name", ""),
                "created_at": iso(now_utc()),
            })
        # списание ингредиентов модификаторов
        for m in it.get("selected_modifiers", []) or []:
            if not ObjectId.is_valid(m.get("option_id", "")):
                continue
            opt = await db.modifier_options.find_one(
                {"_id": ObjectId(m["option_id"]), "restaurant_id": rid})
            if not opt or not opt.get("inventory_id") or not opt.get("amount"):
                continue
            inv = await db.inventory.find_one({"_id": ObjectId(opt["inventory_id"]), "restaurant_id": rid}) if ObjectId.is_valid(opt["inventory_id"]) else None
            stock_unit = inv.get("measure", "kg") if inv else "kg"
            per = convert_amount(opt["amount"], None, stock_unit)
            amt = round(per * it["count"], 4)
            if amt <= 0:
                continue
            await adjust_stock(rid, opt["inventory_id"], wh_id, -amt)
            await db.writeoffs.insert_one({
                "inventory_id": opt["inventory_id"], "name": f"{opt['name']} (модификатор)", "amount": amt,
                "restaurant_id": rid, "warehouse_id": wh_id, "kind": "sale",
                "reason": f"Модификатор: {it['name']}", "created_by": user.get("name", ""),
                "created_at": iso(now_utc()),
            })
    return serialize(await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/orders/{oid}")
async def delete_order(oid: str, req: CancelOrderReq = CancelOrderReq(), user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": rid})
    if not o or o.get("status") == "closed":
        raise HTTPException(status_code=404, detail="Заказ не найден или уже закрыт")
    was_sent = o.get("status") == "sent" or any(
        it.get("print_status") == "printed" for it in o.get("items", []))
    reason = (req.reason or "").strip()
    if was_sent and not reason:
        raise HTTPException(status_code=400, detail="Укажите причину отмены заказа")
    if was_sent:
        await db.order_corrections.insert_one({
            "order_id": oid, "restaurant_id": rid, "item_name": "(отмена заказа)",
            "item_price": o.get("total", 0), "staff_id": user["id"],
            "staff_name": user.get("name", ""), "reason": f"Отмена заказа: {reason}",
            "created_at": iso(now_utc())})
    await db.orders.delete_one({"_id": parse_oid(oid), "restaurant_id": rid})
    return {"success": True}


# ---------------------------------------------------------------------------
# INVENTORY / WAREHOUSE (Склад)
# ---------------------------------------------------------------------------
@api.get("/warehouses")
async def get_warehouses(user: dict = Depends(get_current_user)):
    return await list_docs("warehouses", sort=[("name", 1)], rid=user["restaurant_id"])


@api.post("/warehouses")
async def create_warehouse(req: WarehouseReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"],
           "is_default": False, "created_at": iso(now_utc())}
    res = await db.warehouses.insert_one(doc)
    return serialize(await db.warehouses.find_one({"_id": res.inserted_id}))


@api.put("/warehouses/{whid}")
async def update_warehouse(whid: str, req: WarehouseReq, user: dict = Depends(require_roles("manager"))):
    await db.warehouses.update_one(
        {"_id": parse_oid(whid), "restaurant_id": user["restaurant_id"]}, {"$set": req.model_dump()})
    return serialize(await db.warehouses.find_one({"_id": parse_oid(whid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/warehouses/{whid}")
async def delete_warehouse(whid: str, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    wh = await db.warehouses.find_one({"_id": parse_oid(whid), "restaurant_id": rid})
    if not wh:
        raise HTTPException(status_code=404, detail="Склад не найден")
    if wh.get("is_default"):
        raise HTTPException(status_code=400, detail="Нельзя удалить склад по умолчанию")
    # синхронизируем агрегат inventory.balance: снимаем остатки удаляемого склада
    async for s in db.stock.find({"warehouse_id": whid, "restaurant_id": rid}):
        q = s.get("quantity", 0) or 0
        if q:
            await db.inventory.update_one(
                {"_id": parse_oid(s["inventory_id"]), "restaurant_id": rid}, {"$inc": {"balance": -q}})
    await db.stock.delete_many({"warehouse_id": whid, "restaurant_id": rid})
    await db.warehouses.delete_one({"_id": parse_oid(whid), "restaurant_id": rid})
    return {"success": True}


@api.post("/stock/transfer")
async def transfer_stock(req: StockTransferReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
    if req.from_warehouse_id == req.to_warehouse_id:
        raise HTTPException(status_code=400, detail="Склады должны отличаться")
    from_wh = await resolve_warehouse(rid, req.from_warehouse_id)
    to_wh = await resolve_warehouse(rid, req.to_warehouse_id)
    have = await get_stock_qty(rid, req.inventory_id, from_wh)
    if req.amount > have:
        raise HTTPException(status_code=400, detail=f"Недостаточно остатка на складе-источнике (есть {have})")
    inv = await db.inventory.find_one({"_id": parse_oid(req.inventory_id), "restaurant_id": rid})
    # перемещение не меняет общий balance: -delta на from, +delta на to
    await db.stock.update_one(
        {"restaurant_id": rid, "inventory_id": req.inventory_id, "warehouse_id": from_wh},
        {"$inc": {"quantity": -req.amount}}, upsert=True)
    await db.stock.update_one(
        {"restaurant_id": rid, "inventory_id": req.inventory_id, "warehouse_id": to_wh},
        {"$inc": {"quantity": req.amount}}, upsert=True)
    await db.writeoffs.insert_one({
        "inventory_id": req.inventory_id, "restaurant_id": rid,
        "name": inv["name"] if inv else "", "amount": req.amount,
        "warehouse_id": from_wh, "to_warehouse_id": to_wh,
        "reason": "Перемещение между складами", "kind": "transfer",
        "created_by": user.get("name", ""), "created_at": iso(now_utc()),
    })
    return {"success": True}


@api.get("/inventory")
async def get_inventory(user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    items = await list_docs("inventory", sort=[("name", 1)], rid=rid)
    warehouses = {w["id"]: w["name"] for w in await list_docs("warehouses", rid=rid)}
    stock_docs = await db.stock.find({"restaurant_id": rid}).to_list(20000)
    by_inv = {}
    for s in stock_docs:
        by_inv.setdefault(s["inventory_id"], []).append(
            {"warehouse_id": s["warehouse_id"],
             "warehouse_name": warehouses.get(s["warehouse_id"], "—"),
             "quantity": round(s.get("quantity", 0), 4)})
    for it in items:
        it["stocks"] = by_inv.get(it["id"], [])
    return items


@api.post("/inventory")
async def create_inventory(req: InventoryItemReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    doc = {"name": req.name, "measure": req.measure, "cost": req.cost,
           "balance": 0.0, "processing_loss": req.processing_loss,
           "restaurant_id": rid, "created_at": iso(now_utc())}
    res = await db.inventory.insert_one(doc)
    iid = str(res.inserted_id)
    if req.balance:
        wh = await resolve_warehouse(rid, req.warehouse_id)
        await adjust_stock(rid, iid, wh, req.balance)
    return serialize(await db.inventory.find_one({"_id": res.inserted_id}))


@api.put("/inventory/{iid}")
async def update_inventory(iid: str, req: InventoryItemReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    await db.inventory.update_one(
        {"_id": parse_oid(iid), "restaurant_id": rid},
        {"$set": {"name": req.name, "measure": req.measure, "cost": req.cost,
                  "processing_loss": req.processing_loss}})
    await recompute_products_for_ingredients(rid, [iid])
    return serialize(await db.inventory.find_one({"_id": parse_oid(iid), "restaurant_id": rid}))


@api.delete("/inventory/{iid}")
async def delete_inventory(iid: str, user: dict = Depends(require_roles("manager"))):
    await db.inventory.delete_one({"_id": parse_oid(iid), "restaurant_id": user["restaurant_id"]})
    await db.stock.delete_many({"inventory_id": iid, "restaurant_id": user["restaurant_id"]})
    return {"success": True}


@api.get("/suppliers")
async def get_suppliers(user: dict = Depends(get_current_user)):
    return await list_docs("suppliers", sort=[("name", 1)], rid=user["restaurant_id"])


@api.post("/suppliers")
async def create_supplier(req: SupplierReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.suppliers.insert_one(doc)
    return serialize(await db.suppliers.find_one({"_id": res.inserted_id}))


@api.delete("/suppliers/{sid}")
async def delete_supplier(sid: str, user: dict = Depends(require_roles("manager"))):
    await db.suppliers.delete_one({"_id": parse_oid(sid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Clients (Клиенты и скидки, Задача 4) -----
@api.get("/clients")
async def get_clients(phone: Optional[str] = None, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    if phone:
        digits = "".join(ch for ch in phone if ch.isdigit())
        cl = None
        if len(digits) >= 7:
            cl = await db.clients.find_one(
                {"restaurant_id": rid, "phone_digits": {"$regex": re.escape(digits) + "$"}})
        if not cl:
            raise HTTPException(status_code=404, detail="Клиент не найден")
        return serialize(cl)
    return await list_docs("clients", sort=[("name", 1)], rid=rid)


@api.post("/clients")
async def create_client(req: ClientReq, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    digits = "".join(ch for ch in req.phone if ch.isdigit())
    if await db.clients.find_one({"restaurant_id": rid, "phone_digits": digits}):
        raise HTTPException(status_code=400, detail="Клиент с таким телефоном уже существует")
    doc = {**req.model_dump(), "phone_digits": digits, "bonus_balance": 0.0, "debt_balance": 0.0,
           "restaurant_id": rid, "created_at": iso(now_utc())}
    res = await db.clients.insert_one(doc)
    return serialize(await db.clients.find_one({"_id": res.inserted_id}))


@api.put("/clients/{cid}")
async def update_client(cid: str, req: ClientReq, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    digits = "".join(ch for ch in req.phone if ch.isdigit())
    dup = await db.clients.find_one({"restaurant_id": rid, "phone_digits": digits})
    if dup and str(dup["_id"]) != cid:
        raise HTTPException(status_code=400, detail="Клиент с таким телефоном уже существует")
    await db.clients.update_one(
        {"_id": parse_oid(cid), "restaurant_id": rid},
        {"$set": {**req.model_dump(), "phone_digits": digits}})
    return serialize(await db.clients.find_one({"_id": parse_oid(cid), "restaurant_id": rid}))


@api.delete("/clients/{cid}")
async def delete_client(cid: str, user: dict = Depends(require_roles("manager"))):
    res = await db.clients.delete_one({"_id": parse_oid(cid), "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    return {"success": True}


@api.post("/clients/{cid}/bonus")
async def adjust_bonus(cid: str, req: BonusAdjustReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    cl = await db.clients.find_one({"_id": parse_oid(cid), "restaurant_id": rid})
    if not cl:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    new_bal = round((cl.get("bonus_balance", 0) or 0) + req.amount, 2)
    if new_bal < 0:
        new_bal = 0.0
    await db.clients.update_one({"_id": parse_oid(cid), "restaurant_id": rid}, {"$set": {"bonus_balance": new_bal}})
    await db.loyalty_transactions.insert_one({
        "client_id": cid, "order_id": None, "type": "manual_adjustment",
        "amount": req.amount, "balance_after": new_bal, "note": req.note,
        "staff_id": user["id"], "restaurant_id": rid, "created_at": iso(now_utc())})
    return {"bonus_balance": new_bal}


@api.get("/clients/{cid}/transactions")
async def client_transactions(cid: str, user: dict = Depends(get_current_user)):
    docs = await db.loyalty_transactions.find(
        {"client_id": cid, "restaurant_id": user["restaurant_id"]}).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]


# ----- Loyalty groups (Задача 6) -----
@api.get("/loyalty-groups")
async def get_loyalty_groups(user: dict = Depends(get_current_user)):
    return await list_docs("loyalty_groups", sort=[("name", 1)], rid=user["restaurant_id"])


@api.post("/loyalty-groups")
async def create_loyalty_group(req: LoyaltyGroupReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.loyalty_groups.insert_one(doc)
    return serialize(await db.loyalty_groups.find_one({"_id": res.inserted_id}))


@api.put("/loyalty-groups/{lid}")
async def update_loyalty_group(lid: str, req: LoyaltyGroupReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    grp = await db.loyalty_groups.find_one({"_id": parse_oid(lid), "restaurant_id": rid})
    if not grp:
        raise HTTPException(status_code=404, detail="Группа лояльности не найдена")
    await db.loyalty_groups.update_one({"_id": parse_oid(lid), "restaurant_id": rid}, {"$set": req.model_dump()})
    return serialize(await db.loyalty_groups.find_one({"_id": parse_oid(lid), "restaurant_id": rid}))


@api.delete("/loyalty-groups/{lid}")
async def delete_loyalty_group(lid: str, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    res = await db.loyalty_groups.delete_one({"_id": parse_oid(lid), "restaurant_id": rid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Группа лояльности не найдена")
    await db.clients.update_many({"restaurant_id": rid, "loyalty_group_id": lid}, {"$set": {"loyalty_group_id": None}})
    return {"success": True}


# ----- Promotions (Акции, Задача 6) -----
@api.get("/promotions")
async def get_promotions(user: dict = Depends(get_current_user)):
    return await list_docs("promotions", sort=[("name", 1)], rid=user["restaurant_id"])


@api.get("/promotions/active")
async def get_active_promotions(user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    now = now_utc()
    promos = await db.promotions.find({"restaurant_id": rid, "active": True}).to_list(500)
    return [serialize(p) for p in promos if promo_is_active(p, now)]


@api.post("/promotions")
async def create_promotion(req: PromotionReq, user: dict = Depends(require_roles("manager"))):
    if req.result_type == "discount_percent" and not (0 <= req.result_value <= 100):
        raise HTTPException(status_code=400, detail="Процент скидки должен быть в диапазоне 0–100")
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.promotions.insert_one(doc)
    return serialize(await db.promotions.find_one({"_id": res.inserted_id}))


@api.put("/promotions/{pmid}")
async def update_promotion(pmid: str, req: PromotionReq, user: dict = Depends(require_roles("manager"))):
    if req.result_type == "discount_percent" and not (0 <= req.result_value <= 100):
        raise HTTPException(status_code=400, detail="Процент скидки должен быть в диапазоне 0–100")
    rid = user["restaurant_id"]
    pr = await db.promotions.find_one({"_id": parse_oid(pmid), "restaurant_id": rid})
    if not pr:
        raise HTTPException(status_code=404, detail="Акция не найдена")
    await db.promotions.update_one({"_id": parse_oid(pmid), "restaurant_id": rid}, {"$set": req.model_dump()})
    return serialize(await db.promotions.find_one({"_id": parse_oid(pmid), "restaurant_id": rid}))


@api.delete("/promotions/{pmid}")
async def delete_promotion(pmid: str, user: dict = Depends(require_roles("manager"))):
    res = await db.promotions.delete_one({"_id": parse_oid(pmid), "restaurant_id": user["restaurant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Акция не найдена")
    return {"success": True}


# ----- Возвраты (Задача 9) -----
@api.post("/orders/{oid}/refund")
async def refund_order(oid: str, req: RefundReq, user: dict = Depends(require_roles("admin"))):
    rid = user["restaurant_id"]
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": rid})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o.get("status") != "closed":
        raise HTTPException(status_code=400, detail="Возврат возможен только по закрытому заказу")
    if not req.items or not req.reason.strip():
        raise HTTPException(status_code=400, detail="Укажите позиции и причину возврата")
    items = o.get("items", [])
    refunded = []
    amount = 0.0
    for ri in req.items:
        if ri.index < 0 or ri.index >= len(items):
            raise HTTPException(status_code=400, detail="Неверный индекс позиции")
        it = items[ri.index]
        qty = min(ri.qty, it["count"])
        if qty <= 0:
            continue
        unit = it["price"] + sum(m.get("price_delta", 0) for m in it.get("selected_modifiers", []) or [])
        line = round(unit * qty, 2)
        amount += line
        refunded.append({"original_item_index": ri.index, "qty": qty, "name": it["name"], "price": unit})
        await db.order_corrections.insert_one({
            "order_id": oid, "restaurant_id": rid, "item_name": it["name"], "item_price": line,
            "staff_id": user["id"], "staff_name": user.get("name", ""),
            "reason": f"Возврат: {req.reason}", "created_at": iso(now_utc())})
    doc = {"order_id": oid, "restaurant_id": rid, "items": refunded, "reason": req.reason,
           "amount": round(amount, 2), "staff_id": user["id"], "staff_name": user.get("name", ""),
           "created_at": iso(now_utc())}
    res = await db.refunds.insert_one(doc)
    total_refunded = sum(sum(x["qty"] for x in r["items"]) for r in
                         await db.refunds.find({"order_id": oid, "restaurant_id": rid}).to_list(500))
    total_items = sum(it["count"] for it in items)
    if total_refunded >= total_items:
        await db.orders.update_one({"_id": parse_oid(oid), "restaurant_id": rid}, {"$set": {"status": "refunded"}})
    return serialize(await db.refunds.find_one({"_id": res.inserted_id}))


@api.get("/reports/refunds")
async def report_refunds(start: Optional[str] = None, end: Optional[str] = None,
                         user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    docs = await db.refunds.find({"restaurant_id": rid}).sort("created_at", -1).to_list(5000)
    if start:
        docs = [d for d in docs if (d.get("created_at") or "")[:10] >= start]
    if end:
        docs = [d for d in docs if (d.get("created_at") or "")[:10] <= end]
    total = round(sum(d.get("amount", 0) for d in docs), 2)
    return {"rows": [serialize(d) for d in docs], "total": total}


# ----- Сервисный сбор (Задача 10) -----
@api.put("/settings/service-charge")
async def set_service_charge(req: ServiceChargeReq, user: dict = Depends(require_roles("manager"))):
    await db.settings.update_one({"key": "venue"}, {"$set": {
        "key": "venue", "service_charge_percent": req.service_charge_percent,
        "service_charge_default_enabled": req.service_charge_default_enabled}}, upsert=True)
    return {"success": True}


@api.patch("/orders/{oid}/service-charge")
async def toggle_service_charge(oid: str, req: ToggleReq, user: dict = Depends(get_current_user)):
    r = await db.orders.update_one(
        {"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]},
        {"$set": {"is_service_charge_enabled": req.enabled}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return {"success": True}


# ----- Резервы и депозиты (Задача 11) -----
@api.get("/reservations")
async def get_reservations(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"restaurant_id": user["restaurant_id"]}
    if date:
        q["date"] = date
    docs = await db.reservations.find(q).sort("time_from", 1).to_list(2000)
    return [serialize(d) for d in docs]


@api.post("/reservations")
async def create_reservation(req: ReservationReq, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    hall = req.hall
    if req.table_id and not hall:
        t = await db.tables.find_one({"_id": parse_oid(req.table_id), "restaurant_id": rid})
        hall = (t or {}).get("hall")
    doc = {**req.model_dump(), "hall": hall, "status": "pending", "order_id": None,
           "created_by": user["id"], "restaurant_id": rid, "created_at": iso(now_utc())}
    res = await db.reservations.insert_one(doc)
    return serialize(await db.reservations.find_one({"_id": res.inserted_id}))


@api.patch("/reservations/{rvid}")
async def update_reservation(rvid: str, req: ReservationPatchReq, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    rv = await db.reservations.find_one({"_id": parse_oid(rvid), "restaurant_id": rid})
    if not rv:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    upd = {k: v for k, v in req.model_dump().items() if v is not None}
    await db.reservations.update_one({"_id": parse_oid(rvid), "restaurant_id": rid}, {"$set": upd})
    return serialize(await db.reservations.find_one({"_id": parse_oid(rvid), "restaurant_id": rid}))


@api.delete("/reservations/{rvid}")
async def delete_reservation(rvid: str, user: dict = Depends(get_current_user)):
    r = await db.reservations.delete_one({"_id": parse_oid(rvid), "restaurant_id": user["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    return {"success": True}


@api.post("/orders/{oid}/link-reservation")
async def link_reservation(oid: str, req: dict, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    order = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": rid})
    if not order:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    rv = await db.reservations.find_one({"_id": parse_oid(req.get("reservation_id", "")), "restaurant_id": rid})
    if not rv:
        raise HTTPException(status_code=404, detail="Бронь не найдена")
    await db.orders.update_one({"_id": parse_oid(oid), "restaurant_id": rid},
                               {"$set": {"prepaid_amount": rv.get("deposit_amount", 0) or 0}})
    await db.reservations.update_one({"_id": rv["_id"]}, {"$set": {"order_id": oid, "status": "seated"}})
    return {"success": True}


# ----- Стоп-лист (Задача 13) -----
@api.get("/pos/stop-list")
async def get_stop_list(user: dict = Depends(get_current_user)):
    docs = await db.stop_list.find({"restaurant_id": user["restaurant_id"]}).to_list(2000)
    return [serialize(d) for d in docs]


@api.post("/pos/stop-list/{product_id}")
async def add_stop_list(product_id: str, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    shift = await db.shifts.find_one({"status": "open", "restaurant_id": rid})
    await db.stop_list.update_one(
        {"restaurant_id": rid, "product_id": product_id},
        {"$set": {"restaurant_id": rid, "product_id": product_id, "staff_id": user["id"],
                  "session_id": str(shift["_id"]) if shift else None, "created_at": iso(now_utc())}}, upsert=True)
    return {"success": True}


@api.delete("/pos/stop-list/{product_id}")
async def remove_stop_list(product_id: str, user: dict = Depends(get_current_user)):
    await db.stop_list.delete_one({"restaurant_id": user["restaurant_id"], "product_id": product_id})
    return {"success": True}


# ----- Быстрые комментарии (Задача 12) -----
@api.get("/quick-comments")
async def get_quick_comments(context: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"restaurant_id": user["restaurant_id"]}
    if context:
        q["context"] = context
    docs = await db.quick_comments.find(q).sort("text", 1).to_list(500)
    return [serialize(d) for d in docs]


@api.post("/quick-comments")
async def create_quick_comment(req: QuickCommentReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "created_at": iso(now_utc())}
    res = await db.quick_comments.insert_one(doc)
    return serialize(await db.quick_comments.find_one({"_id": res.inserted_id}))


@api.put("/quick-comments/{qid}")
async def update_quick_comment(qid: str, req: QuickCommentReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    r = await db.quick_comments.update_one({"_id": parse_oid(qid), "restaurant_id": rid}, {"$set": req.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Комментарий не найден")
    return serialize(await db.quick_comments.find_one({"_id": parse_oid(qid), "restaurant_id": rid}))


@api.delete("/quick-comments/{qid}")
async def delete_quick_comment(qid: str, user: dict = Depends(require_roles("manager"))):
    r = await db.quick_comments.delete_one({"_id": parse_oid(qid), "restaurant_id": user["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Комментарий не найден")
    return {"success": True}


# ----- Внесение/изъятие налички (Задача 12) -----
@api.post("/shifts/cash-movement")
async def cash_movement(req: CashMovementReq, user: dict = Depends(require_roles("admin"))):
    rid = user["restaurant_id"]
    shift = await db.shifts.find_one({"status": "open", "restaurant_id": rid})
    if not shift:
        raise HTTPException(status_code=400, detail="Нет открытой смены")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть больше 0")
    doc = {"shift_id": str(shift["_id"]), "restaurant_id": rid, "type": req.type,
           "amount": round(req.amount, 2), "reason": req.reason,
           "staff_id": user["id"], "staff_name": user.get("name", ""), "created_at": iso(now_utc())}
    res = await db.cash_movements.insert_one(doc)
    return serialize(await db.cash_movements.find_one({"_id": res.inserted_id}))


@api.get("/shifts/cash-movements")
async def list_cash_movements(shift_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    rid = user["restaurant_id"]
    sid = shift_id
    if not sid:
        shift = await db.shifts.find_one({"status": "open", "restaurant_id": rid})
        sid = str(shift["_id"]) if shift else None
    if not sid:
        return []
    docs = await db.cash_movements.find({"restaurant_id": rid, "shift_id": sid}).sort("created_at", -1).to_list(1000)
    return [serialize(d) for d in docs]


# ----- Способы оплаты (Задача 14) -----
@api.get("/payment-methods")
async def get_payment_methods(user: dict = Depends(get_current_user)):
    return await list_docs("payment_methods", sort=[("position", 1)], rid=user["restaurant_id"])


@api.post("/payment-methods")
async def create_payment_method(req: PaymentMethodReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    if await db.payment_methods.find_one({"restaurant_id": rid, "code": req.code}):
        raise HTTPException(status_code=400, detail="Способ оплаты с таким кодом уже существует")
    doc = {**req.model_dump(), "restaurant_id": rid, "created_at": iso(now_utc())}
    res = await db.payment_methods.insert_one(doc)
    return serialize(await db.payment_methods.find_one({"_id": res.inserted_id}))


@api.put("/payment-methods/{pmid}")
async def update_payment_method(pmid: str, req: PaymentMethodReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    dup = await db.payment_methods.find_one({"restaurant_id": rid, "code": req.code, "_id": {"$ne": parse_oid(pmid)}})
    if dup:
        raise HTTPException(status_code=400, detail="Способ оплаты с таким кодом уже существует")
    r = await db.payment_methods.update_one({"_id": parse_oid(pmid), "restaurant_id": rid}, {"$set": req.model_dump()})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Способ оплаты не найден")
    return serialize(await db.payment_methods.find_one({"_id": parse_oid(pmid), "restaurant_id": rid}))


@api.delete("/payment-methods/{pmid}")
async def delete_payment_method(pmid: str, user: dict = Depends(require_roles("manager"))):
    r = await db.payment_methods.delete_one({"_id": parse_oid(pmid), "restaurant_id": user["restaurant_id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Способ оплаты не найден")
    return {"success": True}


# ----- Долги клиентов (Задача 14) -----
@api.post("/clients/{cid}/pay-debt")
async def pay_debt(cid: str, req: PayDebtReq, user: dict = Depends(require_roles("manager", "admin"))):
    rid = user["restaurant_id"]
    cl = await db.clients.find_one({"_id": parse_oid(cid), "restaurant_id": rid})
    if not cl:
        raise HTTPException(status_code=404, detail="Клиент не найден")
    bal = cl.get("debt_balance", 0) or 0
    amount = round(min(req.amount, bal), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Нет задолженности или неверная сумма")
    new_bal = round(bal - amount, 2)
    await db.clients.update_one({"_id": parse_oid(cid), "restaurant_id": rid}, {"$set": {"debt_balance": new_bal}})
    await db.debt_transactions.insert_one({
        "client_id": cid, "order_id": None, "type": "payment", "amount": amount,
        "balance_after": new_bal, "payment_method": req.payment_method,
        "staff_id": user["id"], "restaurant_id": rid, "created_at": iso(now_utc())})
    return {"debt_balance": new_bal, "paid": amount}


@api.get("/clients/{cid}/debt-transactions")
async def client_debt_transactions(cid: str, user: dict = Depends(get_current_user)):
    docs = await db.debt_transactions.find(
        {"client_id": cid, "restaurant_id": user["restaurant_id"]}).sort("created_at", -1).to_list(500)
    return [serialize(d) for d in docs]


@api.get("/reports/debts")
async def report_debts(user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    clients = await db.clients.find({"restaurant_id": rid, "debt_balance": {"$gt": 0}}).sort("debt_balance", -1).to_list(2000)
    rows = [serialize(c) for c in clients]
    total = round(sum(c.get("debt_balance", 0) for c in clients), 2)
    return {"rows": rows, "total": total}




@api.get("/invoices")
async def get_invoices(user: dict = Depends(get_current_user)):
    return await list_docs("invoices", sort=[("created_at", -1)], rid=user["restaurant_id"])


@api.post("/invoices")
async def create_invoice(req: InvoiceReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    if await db.invoices.find_one({"number": req.number, "restaurant_id": rid}):
        raise HTTPException(status_code=400, detail="Накладная с таким номером уже существует")
    warehouse_id = await resolve_warehouse(rid, req.warehouse_id)
    items = [i.model_dump() for i in req.items]
    total = round(sum(i["amount"] * i["price"] for i in items), 2)
    doc = {
        "number": req.number,
        "restaurant_id": rid,
        "warehouse_id": warehouse_id,
        "supplier_id": req.supplier_id,
        "supplier_name": req.supplier_name,
        "items": items,
        "total": total,
        "created_by": user.get("name", ""),
        "created_at": iso(now_utc()),
    }
    res = await db.invoices.insert_one(doc)
    # приход: увеличиваем остаток на складе накладной + обновляем себестоимость ингредиента
    touched = set()
    for it in items:
        await adjust_stock(rid, it["inventory_id"], warehouse_id, it["amount"])
        await db.inventory.update_one(
            {"_id": parse_oid(it["inventory_id"]), "restaurant_id": rid},
            {"$set": {"cost": it["price"]}})
        touched.add(it["inventory_id"])
    # пересчёт себестоимости блюд с cost_source=auto, использующих эти ингредиенты
    await recompute_products_for_ingredients(rid, touched)
    return serialize(await db.invoices.find_one({"_id": res.inserted_id}))


@api.get("/writeoffs")
async def get_writeoffs(user: dict = Depends(get_current_user)):
    return await list_docs("writeoffs", sort=[("created_at", -1)], rid=user["restaurant_id"])


@api.post("/writeoffs")
async def create_writeoff(req: WriteOffReq, user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    inv = await db.inventory.find_one({"_id": parse_oid(req.inventory_id), "restaurant_id": rid})
    if not inv:
        raise HTTPException(status_code=404, detail="Позиция склада не найдена")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
    warehouse_id = await resolve_warehouse(rid, req.warehouse_id)
    have = await get_stock_qty(rid, req.inventory_id, warehouse_id)
    if req.amount > have:
        raise HTTPException(status_code=400, detail=f"Недостаточно остатка на складе (есть {have})")
    doc = {
        "inventory_id": req.inventory_id,
        "restaurant_id": rid,
        "warehouse_id": warehouse_id,
        "name": inv["name"],
        "amount": req.amount,
        "reason": req.reason,
        "kind": "manual",
        "created_by": user.get("name", ""),
        "created_at": iso(now_utc()),
    }
    res = await db.writeoffs.insert_one(doc)
    await adjust_stock(rid, req.inventory_id, warehouse_id, -req.amount)
    return serialize(await db.writeoffs.find_one({"_id": res.inserted_id}))


# ---------------------------------------------------------------------------
# REPORTS / DASHBOARD
# ---------------------------------------------------------------------------
@api.get("/reports/dashboard")
async def dashboard(user: dict = Depends(require_roles("manager"))):
    today = now_utc().date().isoformat()
    closed = await db.orders.find({"status": "closed", "restaurant_id": user["restaurant_id"]}).to_list(10000)
    today_orders = [o for o in closed if (o.get("closed_at") or "")[:10] == today]
    revenue_today = round(sum(o.get("total", 0) for o in today_orders), 2)
    orders_today = len(today_orders)
    avg_check = round(revenue_today / orders_today, 2) if orders_today else 0

    # last 7 days revenue
    days = []
    for i in range(6, -1, -1):
        d = (now_utc().date() - timedelta(days=i)).isoformat()
        rev = round(sum(o.get("total", 0) for o in closed if (o.get("closed_at") or "")[:10] == d), 2)
        days.append({"date": d, "revenue": rev})

    # top products (all time)
    prod_map = {}
    for o in closed:
        for it in o.get("items", []):
            key = it["name"]
            prod_map.setdefault(key, {"name": key, "count": 0, "revenue": 0})
            prod_map[key]["count"] += it["count"]
            prod_map[key]["revenue"] += it["total"]
    top = sorted(prod_map.values(), key=lambda x: x["revenue"], reverse=True)[:5]
    for t in top:
        t["revenue"] = round(t["revenue"], 2)

    total_revenue = round(sum(o.get("total", 0) for o in closed), 2)
    return {
        "revenue_today": revenue_today,
        "orders_today": orders_today,
        "avg_check": avg_check,
        "total_revenue": total_revenue,
        "total_orders": len(closed),
        "revenue_7days": days,
        "top_products": top,
    }


@api.get("/reports/sales")
async def sales_report(start: Optional[str] = None, end: Optional[str] = None,
                       group_by: Optional[str] = None,
                       user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    closed = await db.orders.find({"status": "closed", "restaurant_id": rid}).to_list(10000)
    if start:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] >= start]
    if end:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] <= end]

    if group_by == "client":
        clients = {str(c["_id"]): c for c in await db.clients.find({"restaurant_id": rid}).to_list(5000)}
        cmap = {}
        for o in closed:
            cid = o.get("client_id")
            if not cid:
                continue
            cl = clients.get(cid)
            name = (cl or {}).get("name") or o.get("client_name") or "—"
            row = cmap.setdefault(cid, {"client_id": cid, "client_name": name,
                                        "order_count": 0, "total_revenue": 0.0, "total_discount": 0.0})
            row["order_count"] += 1
            row["total_revenue"] += o.get("total", 0)
            row["total_discount"] += o.get("discount", 0)
        rows = sorted(cmap.values(), key=lambda x: x["total_revenue"], reverse=True)
        for r in rows:
            r["total_revenue"] = round(r["total_revenue"], 2)
            r["total_discount"] = round(r["total_discount"], 2)
        return {"rows": rows,
                "total_revenue": round(sum(r["total_revenue"] for r in rows), 2),
                "total_discount": round(sum(r["total_discount"] for r in rows), 2)}

    total = round(sum(o.get("total", 0) for o in closed), 2)
    cash = round(sum(o.get("total", 0) for o in closed if o.get("payment_method") == "cash"), 2)
    card = round(sum(o.get("total", 0) for o in closed if o.get("payment_method") == "card"), 2)

    # by product
    prod_map = {}
    for o in closed:
        for it in o.get("items", []):
            prod_map.setdefault(it["name"], {"name": it["name"], "count": 0, "revenue": 0})
            prod_map[it["name"]]["count"] += it["count"]
            prod_map[it["name"]]["revenue"] += it["total"]
    by_product = sorted(prod_map.values(), key=lambda x: x["revenue"], reverse=True)
    for p in by_product:
        p["revenue"] = round(p["revenue"], 2)

    # by cashier
    cashier_map = {}
    for o in closed:
        name = o.get("cashier_name") or "—"
        cashier_map.setdefault(name, {"name": name, "count": 0, "revenue": 0})
        cashier_map[name]["count"] += 1
        cashier_map[name]["revenue"] += o.get("total", 0)
    by_cashier = sorted(cashier_map.values(), key=lambda x: x["revenue"], reverse=True)
    for c in by_cashier:
        c["revenue"] = round(c["revenue"], 2)

    return {
        "total": total, "cash": cash, "card": card, "orders": len(closed),
        "by_product": by_product, "by_cashier": by_cashier,
    }


@api.get("/reports/corrections")
async def corrections_report(start: Optional[str] = None, end: Optional[str] = None,
                             user: dict = Depends(require_roles("manager"))):
    docs = await db.order_corrections.find({"restaurant_id": user["restaurant_id"]}).sort("created_at", -1).to_list(2000)
    out = []
    for d in docs:
        day = (d.get("created_at") or "")[:10]
        if start and day < start:
            continue
        if end and day > end:
            continue
        out.append(serialize(d))
    return out


@api.get("/reports/analytics")
async def analytics_report(start: Optional[str] = None, end: Optional[str] = None,
                           user: dict = Depends(require_roles("manager"))):
    closed = await db.orders.find({"status": "closed", "restaurant_id": user["restaurant_id"]}).to_list(20000)
    if start:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] >= start]
    if end:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] <= end]
    prods = await db.products.find({"restaurant_id": user["restaurant_id"]}).to_list(3000)
    cost_by_id = {str(p["_id"]): p.get("cost", 0) for p in prods}
    cost_by_name = {p["name"]: p.get("cost", 0) for p in prods}

    by_hour = {h: 0.0 for h in range(24)}
    total = 0.0
    margin_map = {}
    for o in closed:
        total += o.get("total", 0)
        ca = o.get("closed_at") or ""
        try:
            h = int(ca[11:13])
        except Exception:
            h = 0
        by_hour[h] = by_hour.get(h, 0) + o.get("total", 0)
        for it in o.get("items", []):
            c = cost_by_id.get(it.get("product_id"))
            if c is None:
                c = cost_by_name.get(it["name"], 0)
            m = margin_map.setdefault(it["name"], {"name": it["name"], "qty": 0, "revenue": 0.0, "cost": 0.0})
            m["qty"] += it["count"]
            m["revenue"] += it.get("total", it["price"] * it["count"])
            m["cost"] += (c or 0) * it["count"]

    orders = len(closed)
    margin = []
    for m in margin_map.values():
        rev, cost = round(m["revenue"], 2), round(m["cost"], 2)
        margin.append({"name": m["name"], "qty": m["qty"], "revenue": rev, "cost": cost,
                       "margin": round(rev - cost, 2),
                       "margin_pct": round((rev - cost) / rev * 100, 1) if rev else 0})
    margin.sort(key=lambda x: x["margin"], reverse=True)
    return {
        "total": round(total, 2), "orders": orders,
        "avg_check": round(total / orders, 2) if orders else 0,
        "by_hour": [{"hour": f"{h:02d}", "revenue": round(by_hour[h], 2)} for h in range(24)],
        "margin_by_product": margin,
    }


async def _closed_in_range(start, end, rid):
    closed = await db.orders.find({"status": "closed", "restaurant_id": rid}).to_list(20000)
    if start:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] >= start]
    if end:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] <= end]
    return closed


@api.get("/reports/by-category")
async def report_by_category(start: Optional[str] = None, end: Optional[str] = None,
                             user: dict = Depends(require_roles("manager"))):
    closed = await _closed_in_range(start, end, user["restaurant_id"])
    prods = await db.products.find({"restaurant_id": user["restaurant_id"]}).to_list(3000)
    cat_of_prod = {str(p["_id"]): p.get("category_id") for p in prods}
    cats = await db.categories.find({"restaurant_id": user["restaurant_id"]}).to_list(1000)
    cat_name = {str(c["_id"]): c["name"] for c in cats}
    agg = {}
    for o in closed:
        for it in o.get("items", []):
            cid = cat_of_prod.get(it.get("product_id"))
            key = cid or "none"
            label = cat_name.get(cid, "Без категории")
            a = agg.setdefault(key, {"name": label, "count": 0, "revenue": 0.0})
            a["count"] += it["count"]
            a["revenue"] += it.get("total", it["price"] * it["count"])
    rows = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)
    for r in rows:
        r["revenue"] = round(r["revenue"], 2)
    return {"rows": rows, "total": round(sum(r["revenue"] for r in rows), 2)}


@api.get("/reports/by-workshop")
async def report_by_workshop(start: Optional[str] = None, end: Optional[str] = None,
                             user: dict = Depends(require_roles("manager"))):
    closed = await _closed_in_range(start, end, user["restaurant_id"])
    ws = await db.workshops.find({"restaurant_id": user["restaurant_id"]}).to_list(1000)
    ws_name = {str(w["_id"]): w["name"] for w in ws}
    agg = {}
    for o in closed:
        for it in o.get("items", []):
            wid = it.get("workshop_id")
            key = wid or "none"
            label = ws_name.get(wid, "Без цеха")
            a = agg.setdefault(key, {"name": label, "count": 0, "revenue": 0.0})
            a["count"] += it["count"]
            a["revenue"] += it.get("total", it["price"] * it["count"])
    rows = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)
    for r in rows:
        r["revenue"] = round(r["revenue"], 2)
    return {"rows": rows, "total": round(sum(r["revenue"] for r in rows), 2)}


@api.get("/reports/abc")
async def report_abc(start: Optional[str] = None, end: Optional[str] = None,
                     metric: str = "revenue", user: dict = Depends(require_roles("manager"))):
    closed = await _closed_in_range(start, end, user["restaurant_id"])
    agg = {}
    for o in closed:
        for it in o.get("items", []):
            a = agg.setdefault(it["name"], {"name": it["name"], "count": 0, "revenue": 0.0})
            a["count"] += it["count"]
            a["revenue"] += it.get("total", it["price"] * it["count"])
    key = "count" if metric == "count" else "revenue"
    rows = sorted(agg.values(), key=lambda x: x[key], reverse=True)
    grand = sum(r[key] for r in rows) or 1
    cum = 0.0
    out = []
    for r in rows:
        cum += r[key]
        share = cum / grand * 100
        cls = "A" if share <= 80 else ("B" if share <= 95 else "C")
        out.append({"name": r["name"], "count": r["count"], "revenue": round(r["revenue"], 2),
                    "cum_pct": round(share, 1), "abc": cls})
    return {"rows": out, "metric": metric,
            "total": round(sum(r["revenue"] for r in rows), 2)}


@api.get("/reports/inventory")
async def report_inventory(warehouse_id: Optional[str] = None,
                           user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    inv = {str(i["_id"]): i for i in await db.inventory.find({"restaurant_id": rid}).to_list(3000)}
    warehouses = {w["id"]: w["name"] for w in await list_docs("warehouses", rid=rid)}
    q = {"restaurant_id": rid}
    if warehouse_id:
        q["warehouse_id"] = warehouse_id
    stock_docs = await db.stock.find(q).to_list(20000)
    rows = []
    for s in stock_docs:
        item = inv.get(s["inventory_id"])
        if not item:
            continue
        qty = round(s.get("quantity", 0), 4)
        cost = item.get("cost", 0)
        rows.append({
            "inventory_id": s["inventory_id"], "name": item["name"],
            "measure": item.get("measure", ""),
            "warehouse_id": s["warehouse_id"],
            "warehouse_name": warehouses.get(s["warehouse_id"], "—"),
            "quantity": qty, "cost": cost, "value": round(qty * cost, 2),
        })
    rows.sort(key=lambda r: (r["warehouse_name"], r["name"]))
    return {"rows": rows, "total_value": round(sum(r["value"] for r in rows), 2),
            "warehouses": [{"id": k, "name": v} for k, v in warehouses.items()]}


@api.get("/reports/stock-movement")
async def report_stock_movement(warehouse_id: Optional[str] = None,
                                start: Optional[str] = None, end: Optional[str] = None,
                                user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    inv_names = {str(i["_id"]): i["name"] for i in await db.inventory.find({"restaurant_id": rid}).to_list(3000)}

    def in_range(ts):
        d = (ts or "")[:10]
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    # Приход из накладных (позиции склада прихода)
    inflow = {}
    invoices = await db.invoices.find({"restaurant_id": rid}).to_list(20000)
    for inv in invoices:
        if not in_range(inv.get("created_at")):
            continue
        if warehouse_id and inv.get("warehouse_id") != warehouse_id:
            continue
        for it in inv.get("items", []):
            a = inflow.setdefault(it["inventory_id"], {"name": it["name"], "in": 0.0, "out": 0.0})
            a["in"] += it["amount"]

    # Расход из списаний (ручные + продажи), исключая перемещения
    for wo in await db.writeoffs.find({"restaurant_id": rid}).to_list(50000):
        if not in_range(wo.get("created_at")):
            continue
        if wo.get("kind") == "transfer":
            continue
        if warehouse_id and wo.get("warehouse_id") != warehouse_id:
            continue
        a = inflow.setdefault(wo["inventory_id"], {"name": wo.get("name", ""), "in": 0.0, "out": 0.0})
        a["out"] += wo.get("amount", 0)

    rows = []
    for iid, a in inflow.items():
        rows.append({"inventory_id": iid, "name": inv_names.get(iid, a["name"]),
                     "in_qty": round(a["in"], 4), "out_qty": round(a["out"], 4),
                     "net": round(a["in"] - a["out"], 4)})
    rows.sort(key=lambda r: r["name"])
    warehouses = {w["id"]: w["name"] for w in await list_docs("warehouses", rid=rid)}
    return {"rows": rows,
            "warehouses": [{"id": k, "name": v} for k, v in warehouses.items()]}


@api.get("/reports/by-hall")
async def report_by_hall(start: Optional[str] = None, end: Optional[str] = None,
                         user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    closed = await _closed_in_range(start, end, rid)
    tables = {str(t["_id"]): t.get("hall", "—") for t in await db.tables.find({"restaurant_id": rid}).to_list(2000)}
    agg = {}
    for o in closed:
        hall = tables.get(o.get("table_id"), "Без зала")
        a = agg.setdefault(hall, {"hall": hall, "order_count": 0, "revenue": 0.0})
        a["order_count"] += 1
        a["revenue"] += o.get("total", 0)
    rows = sorted(agg.values(), key=lambda x: x["revenue"], reverse=True)
    for r in rows:
        r["revenue"] = round(r["revenue"], 2)
    return {"rows": rows, "total": round(sum(r["revenue"] for r in rows), 2)}


@api.get("/reports/promotions")
async def report_promotions(start: Optional[str] = None, end: Optional[str] = None,
                            user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    closed = await _closed_in_range(start, end, rid)
    agg = {}
    for o in closed:
        for ap in (o.get("applied_promotions") or []):
            a = agg.setdefault(ap["promotion_id"], {"name": ap.get("name", ""), "times": 0,
                                                     "discount_value": 0.0, "revenue": 0.0})
            a["times"] += 1
            a["discount_value"] += ap.get("discount_amount", 0)
            a["revenue"] += o.get("total", 0)
    rows = []
    for pid, a in agg.items():
        roi = round(a["revenue"] / a["discount_value"], 2) if a["discount_value"] else None
        rows.append({"promotion_id": pid, "name": a["name"], "times_applied": a["times"],
                     "discount_value": round(a["discount_value"], 2),
                     "revenue": round(a["revenue"], 2), "roi": roi})
    rows.sort(key=lambda r: r["times_applied"], reverse=True)
    return {"rows": rows}


@api.get("/reports/loyalty")
async def report_loyalty(start: Optional[str] = None, end: Optional[str] = None,
                         user: dict = Depends(require_roles("manager"))):
    rid = user["restaurant_id"]
    txns = await db.loyalty_transactions.find({"restaurant_id": rid}).to_list(50000)

    def in_range(ts):
        d = (ts or "")[:10]
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    accrued = sum(t["amount"] for t in txns if t.get("type") == "accrual" and in_range(t.get("created_at")))
    redeemed = sum(t["amount"] for t in txns if t.get("type") == "redemption" and in_range(t.get("created_at")))
    clients = await db.clients.find({"restaurant_id": rid}).to_list(20000)
    outstanding = sum(c.get("bonus_balance", 0) or 0 for c in clients)
    return {"total_accrued": round(accrued, 2), "total_redeemed": round(redeemed, 2),
            "outstanding_balance": round(outstanding, 2)}







# ---------------------------------------------------------------------------
# PRINTING — ESC/POS rendering, printers, print jobs, agent bridge API
# ---------------------------------------------------------------------------
def escpos_encode(text: str, codepage_label: str) -> bytes:
    try:
        return text.encode(codepage_label, errors="replace")
    except LookupError:
        return text.encode("cp866", errors="replace")


def render_escpos(lines: List[str], codepage_label: str = "cp866", escape_t_value: int = 17,
                  logo_raster: Optional[bytes] = None) -> bytes:
    """Собирает ESC/POS буфер. Кодовая страница задаётся ТОЛЬКО полем принтера
    escape_t_value (ESC t <n>) — это эмпирическое число под конкретную модель, а не
    производное от названия кодировки. Кириллица кодируется в codepage_label (cp866)."""
    ESC = b"\x1b"
    GS = b"\x1d"
    buf = bytearray()
    buf += ESC + b"@"                                # init/reset
    if logo_raster:
        buf += ESC + b"a" + b"\x01" + logo_raster + ESC + b"a" + b"\x00" + b"\n"  # логотип по центру
    buf += ESC + b"t" + bytes([escape_t_value & 0xFF])  # select code page (per-printer)
    if lines:
        # заголовок: по центру, жирный, двойная высота (кросс-принтерные команды)
        buf += ESC + b"a" + b"\x01"
        buf += ESC + b"E" + b"\x01"
        buf += GS + b"!" + b"\x01"
        buf += escpos_encode(lines[0] + "\n", codepage_label)
        buf += GS + b"!" + b"\x00"
        buf += ESC + b"E" + b"\x00"
        buf += ESC + b"a" + b"\x00"
        for ln in lines[1:]:
            buf += escpos_encode(ln + "\n", codepage_label)
    buf += b"\n\n\n" + GS + b"V" + b"\x00"           # feed + full cut
    return bytes(buf)


def _pad(left: str, right: str, w: int = 32) -> str:
    space = max(1, w - len(left) - len(right))
    return left + " " * space + right


def _fmt_count(c) -> str:
    return str(int(c)) if float(c) == int(c) else str(c)


def build_lines(kind: str, table_name: str, waiter: str, items: List[dict], subtotal=None, venue=None) -> List[str]:
    venue = venue or {}
    lines = []
    if kind == "precheck":
        name = (venue.get("name") or "").strip()
        lines.append(name if name else "ПРЕДЧЕК")           # первая строка — крупно/по центру
        if venue.get("address"):
            lines.append(venue["address"])
        if venue.get("phone"):
            lines.append("тел. " + venue["phone"])
        lines.append("--- ПРЕДЧЕК ---")
    else:
        lines.append({"ticket": "*** ЗАКАЗ ***", "void": "*** СТОРНО ***"}.get(kind, "ЧЕК"))
    lines += [f"Стол: {table_name}", f"Официант: {waiter}",
              now_utc().strftime("%d.%m.%Y %H:%M"), "-" * 32]
    ordered = sorted(items, key=lambda x: (x.get("course_number") or 0))
    prev_course = None
    for it in ordered:
        cn = it.get("course_number") or 0
        if kind != "precheck" and cn and cn != prev_course:
            lines.append(f"-- Подача {cn} --")
            prev_course = cn
        if kind == "precheck":
            total = it.get("total", it["price"] * it["count"])
            lines.append(_pad(f"{it['name']} x{_fmt_count(it['count'])}", f"{total:.2f}"))
        else:
            lines.append(f"{it['name']} x{_fmt_count(it['count'])}")
        for m in it.get("selected_modifiers", []) or []:
            d = m.get("price_delta", 0)
            suffix = f" (+{d:.2f})" if d else ""
            lines.append(f"  + {m.get('name', '')}{suffix}")
        if it.get("comment"):
            lines.append(f"  * {it['comment']}")
    if kind == "precheck" and subtotal is not None:
        lines.append("-" * 32)
        lines.append(_pad("ИТОГО:", f"{subtotal:.2f}"))
        if venue.get("footer_note"):
            lines.append("")
            lines.append(venue["footer_note"])
    return lines


async def _table_name(tid) -> str:
    if not tid or not ObjectId.is_valid(tid):
        return "—"
    t = await db.tables.find_one({"_id": ObjectId(tid)})
    return t["name"] if t else "—"


async def make_job(order: dict, printer: dict, jtype: str, items: List[dict], subtotal=None) -> dict:
    table_name = await _table_name(order.get("table_id"))
    venue = await db.settings.find_one({"key": "venue"}) or {}
    lines = build_lines(jtype, table_name, order.get("waiter_name", ""), items, subtotal, venue)
    codepage_label = printer.get("codepage_label", "cp866")
    escape_t_value = printer.get("escape_t_value", 17)
    logo = None
    if venue.get("logo_enabled") and venue.get("logo_image"):
        try:
            logo = _raster_bytes(base64.b64decode(_b64_from_dataurl(venue["logo_image"])),
                                 width_dots_for(printer.get("paper_width_mm", 80)), max_h=400)
        except Exception:
            logo = None
    payload = base64.b64encode(render_escpos(lines, codepage_label, escape_t_value, logo_raster=logo)).decode()
    return await create_raw_job(printer, jtype, payload, "\n".join(lines), order_id=str(order["_id"]))


async def create_raw_job(printer: dict, jtype: str, payload_b64: str, text_preview: str, order_id=None) -> dict:
    doc = {
        "order_id": order_id,
        "restaurant_id": printer.get("restaurant_id"),
        "printer_id": str(printer["_id"]),
        "printer_name": printer["name"],
        "printer_ip": printer.get("local_ip"),
        "printer_port": printer.get("port", 9100),
        "station": printer["station"],
        "type": jtype,
        "payload": payload_b64,
        "text": text_preview,
        "status": "pending",
        "attempts": 0,
        "error_message": None,
        "created_at": iso(now_utc()),
        "sent_at": None,
        "printed_at": None,
    }
    res = await db.print_jobs.insert_one(doc)
    return serialize(await db.print_jobs.find_one({"_id": res.inserted_id}))


def width_dots_for(paper_width_mm: int) -> int:
    return 384 if paper_width_mm and paper_width_mm <= 58 else 576


_UNIT_FACTOR = {"kg": 1.0, "g": 0.001, "l": 1.0, "ml": 0.001, "pcs": 1.0}
_UNIT_FAMILY = {"kg": "mass", "g": "mass", "l": "vol", "ml": "vol", "pcs": "count"}


def convert_amount(amount: float, from_unit: Optional[str], to_unit: str) -> float:
    """Пересчёт количества из единицы тех.карты в единицу склада (кг↔г, л↔мл)."""
    fu = from_unit or to_unit
    if fu == to_unit:
        return amount
    if _UNIT_FAMILY.get(fu) == _UNIT_FAMILY.get(to_unit) and fu in _UNIT_FACTOR and to_unit in _UNIT_FACTOR:
        return amount * _UNIT_FACTOR[fu] / _UNIT_FACTOR[to_unit]
    return amount  # разные семейства единиц — без пересчёта


def _b64_from_dataurl(s: str) -> str:
    if s and "," in s and s.strip().startswith("data:"):
        return s.split(",", 1)[1]
    return s or ""


def _raster_bytes(image_bytes: bytes, width_dots: int = 576, max_h: int = 1600) -> bytes:
    """Только команда растрового изображения GS v 0 (без init/cut/выравнивания)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("L")
    w, h = img.size
    if w > width_dots:
        h = max(1, int(h * width_dots / w)); w = width_dots
        img = img.resize((w, h))
    if h > max_h:
        w = max(1, int(w * max_h / h)); h = max_h
        img = img.resize((w, h))
    img = img.convert("1")
    px = img.load()
    width_bytes = (w + 7) // 8
    GS = b"\x1d"
    buf = bytearray()
    buf += GS + b"v0" + b"\x00"
    buf += bytes([width_bytes & 0xFF, (width_bytes >> 8) & 0xFF, h & 0xFF, (h >> 8) & 0xFF])
    for y in range(h):
        row = bytearray(width_bytes)
        for x in range(w):
            if px[x, y] == 0:
                row[x // 8] |= (0x80 >> (x % 8))
        buf += bytes(row)
    return bytes(buf)


def image_to_escpos(image_bytes: bytes, width_dots: int = 576) -> bytes:
    ESC = b"\x1b"; GS = b"\x1d"
    raster = _raster_bytes(image_bytes, width_dots)
    return bytes(ESC + b"@" + ESC + b"a" + b"\x01" + raster + ESC + b"a" + b"\x00" + b"\n\n\n" + GS + b"V" + b"\x00")


async def logo_raster_for(printer: dict) -> Optional[bytes]:
    """Растр логотипа заведения под ширину ленты конкретного принтера (если включён)."""
    s = await db.settings.find_one({"key": "venue"})
    if not s or not s.get("logo_enabled") or not s.get("logo_image"):
        return None
    try:
        raw = base64.b64decode(_b64_from_dataurl(s["logo_image"]))
        return _raster_bytes(raw, width_dots_for(printer.get("paper_width_mm", 80)), max_h=400)
    except Exception:
        return None


@api.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"key": "venue"}) or {}
    return {
        "logo_enabled": bool(doc.get("logo_enabled")),
        "logo_image": doc.get("logo_image"),
        "name": doc.get("name", ""),
        "address": doc.get("address", ""),
        "phone": doc.get("phone", ""),
        "footer_note": doc.get("footer_note", ""),
        "max_bonus_payment_percent": doc.get("max_bonus_payment_percent", 50),
        "service_charge_percent": doc.get("service_charge_percent", 0),
        "service_charge_default_enabled": doc.get("service_charge_default_enabled", False),
    }


@api.put("/settings/receipt")
async def set_receipt(req: ReceiptSettingsReq, user: dict = Depends(require_roles("manager"))):
    update = {}
    for k, v in req.model_dump().items():
        if v is None:
            continue
        update[k] = v if k == "max_bonus_payment_percent" else (v or "")
    await db.settings.update_one({"key": "venue"}, {"$set": {"key": "venue", **update}}, upsert=True)
    doc = await db.settings.find_one({"key": "venue"})
    return {"name": doc.get("name", ""), "address": doc.get("address", ""),
            "phone": doc.get("phone", ""), "footer_note": doc.get("footer_note", "")}


@api.put("/settings/logo")
async def set_logo(req: LogoReq, user: dict = Depends(require_roles("manager"))):
    update = {}
    if req.image is not None:
        # валидируем, что это корректное изображение
        try:
            Image.open(io.BytesIO(base64.b64decode(_b64_from_dataurl(req.image)))).verify()
        except Exception:
            raise HTTPException(status_code=400, detail="Не удалось обработать изображение. Загрузите корректный PNG или JPG.")
        update["logo_image"] = req.image
        update["logo_enabled"] = True if req.enabled is None else req.enabled
    if req.enabled is not None:
        update["logo_enabled"] = req.enabled
    await db.settings.update_one({"key": "venue"}, {"$set": {"key": "venue", **update}}, upsert=True)
    doc = await db.settings.find_one({"key": "venue"})
    return {"logo_enabled": bool(doc.get("logo_enabled")), "logo_image": doc.get("logo_image")}


@api.delete("/settings/logo")
async def delete_logo(user: dict = Depends(require_roles("manager"))):
    await db.settings.update_one({"key": "venue"}, {"$set": {"key": "venue", "logo_image": None, "logo_enabled": False}}, upsert=True)
    return {"success": True}


# ----- Printers CRUD -----
@api.get("/printers")
async def list_printers(user: dict = Depends(get_current_user)):
    return await list_docs("printers", sort=[("name", 1)], rid=user["restaurant_id"])


@api.post("/printers")
async def create_printer(req: PrinterReq, user: dict = Depends(require_roles("manager"))):
    doc = {**req.model_dump(), "restaurant_id": user["restaurant_id"], "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())}
    res = await db.printers.insert_one(doc)
    return serialize(await db.printers.find_one({"_id": res.inserted_id}))


@api.patch("/printers/{pid}")
async def update_printer(pid: str, req: PrinterReq, user: dict = Depends(require_roles("manager"))):
    await db.printers.update_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]}, {"$set": req.model_dump()})
    return serialize(await db.printers.find_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]}))


@api.delete("/printers/{pid}")
async def delete_printer(pid: str, user: dict = Depends(require_roles("manager"))):
    await db.printers.delete_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


@api.post("/printers/{pid}/test")
async def printer_test(pid: str, user: dict = Depends(require_roles("manager"))):
    printer = await db.printers.find_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]})
    if not printer:
        raise HTTPException(status_code=404, detail="Принтер не найден")
    lines = [
        "*** ТЕСТ ПЕЧАТИ ***",
        printer["name"],
        f"{printer.get('local_ip')}:{printer.get('port')}",
        f"{printer.get('codepage_label')} / ESC t {printer.get('escape_t_value')}",
        now_utc().strftime("%d.%m.%Y %H:%M"),
        "-" * 32,
        "Кириллица: съешь ещё этих",
        "мягких булочек да выпей чаю",
        "ЁЙЦУКЕН  0123456789",
        "Цена: 1 234.50 " + chr(0x20BD),
        "-" * 32,
        "Если текст читается — принтер",
        "настроен верно.",
    ]
    payload = base64.b64encode(render_escpos(lines, printer.get("codepage_label", "cp866"),
                                             printer.get("escape_t_value", 17))).decode()
    job = await create_raw_job(printer, "test", payload, "\n".join(lines))
    return {"success": True, "job": job}


@api.post("/printers/{pid}/print-text")
async def printer_print_text(pid: str, req: PrintTextReq, user: dict = Depends(require_roles("manager"))):
    printer = await db.printers.find_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]})
    if not printer:
        raise HTTPException(status_code=404, detail="Принтер не найден")
    lines = (req.text or "").split("\n") or [""]
    payload = base64.b64encode(render_escpos(lines, printer.get("codepage_label", "cp866"),
                                             printer.get("escape_t_value", 17))).decode()
    job = await create_raw_job(printer, "text", payload, "\n".join(lines))
    return {"success": True, "job": job}


@api.post("/printers/{pid}/print-image")
async def printer_print_image(pid: str, req: PrintImageReq, user: dict = Depends(require_roles("manager"))):
    printer = await db.printers.find_one({"_id": parse_oid(pid), "restaurant_id": user["restaurant_id"]})
    if not printer:
        raise HTTPException(status_code=404, detail="Принтер не найден")
    data = req.image or ""
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    try:
        raw = base64.b64decode(data)
        payload_bytes = image_to_escpos(raw, width_dots_for(printer.get("paper_width_mm", 80)))
    except Exception:
        raise HTTPException(status_code=400, detail="Не удалось обработать изображение. Загрузите корректный PNG или JPG.")
    payload = base64.b64encode(payload_bytes).decode()
    job = await create_raw_job(printer, "image", payload, "🖼 Изображение отправлено на печать")
    return {"success": True, "job": job}


# ----- Print agents -----
@api.get("/agents")
async def list_agents(user: dict = Depends(require_roles("manager"))):
    return await list_docs("print_agents", sort=[("created_at", -1)], rid=user["restaurant_id"])


@api.post("/agents")
async def create_agent(req: AgentReq, user: dict = Depends(require_roles("manager"))):
    doc = {"name": req.name, "restaurant_id": user["restaurant_id"], "api_key": secrets.token_hex(24),
           "last_heartbeat_at": None, "created_at": iso(now_utc())}
    res = await db.print_agents.insert_one(doc)
    return serialize(await db.print_agents.find_one({"_id": res.inserted_id}))


@api.delete("/agents/{aid}")
async def delete_agent(aid: str, user: dict = Depends(require_roles("manager"))):
    await db.print_agents.delete_one({"_id": parse_oid(aid), "restaurant_id": user["restaurant_id"]})
    return {"success": True}


# ----- Print jobs (admin view) -----
@api.get("/print-jobs")
async def list_print_jobs(user: dict = Depends(require_roles("manager"))):
    docs = await db.print_jobs.find({"restaurant_id": user["restaurant_id"]}).sort("created_at", -1).to_list(200)
    return [serialize(d) for d in docs]


@api.post("/print-jobs/{jid}/retry")
async def retry_print_job(jid: str, user: dict = Depends(require_roles("manager"))):
    job = await db.print_jobs.find_one({"_id": parse_oid(jid), "restaurant_id": user["restaurant_id"]})
    if not job:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    await db.print_jobs.update_one(
        {"_id": parse_oid(jid), "restaurant_id": user["restaurant_id"]},
        {"$set": {"status": "pending", "error_message": None, "sent_at": None, "printed_at": None}},
    )
    return serialize(await db.print_jobs.find_one({"_id": parse_oid(jid), "restaurant_id": user["restaurant_id"]}))


# ----- Order printing actions -----
@api.post("/orders/{oid}/request-bill")
async def request_bill(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    printer = await db.printers.find_one({"station": "precheck", "active": True, "restaurant_id": o.get("restaurant_id")})
    if not printer:
        raise HTTPException(status_code=400, detail="Не настроен принтер пречека (станция precheck)")
    job = await make_job(o, printer, "precheck", o["items"], o.get("subtotal"))
    return {"success": True, "job": job}


@api.delete("/orders/{oid}/items/{idx}")
async def void_order_item(oid: str, idx: int, req: VoidItemReq = VoidItemReq(), user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    items = o["items"]
    if idx < 0 or idx >= len(items):
        raise HTTPException(status_code=404, detail="Позиция не найдена")
    removed = items[idx]
    is_sent = removed.get("print_status", "pending") != "pending"
    # Задача 1: защищённое удаление уже отправленной позиции — причина + подтверждение админа
    if is_sent:
        reason = (req.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="Укажите причину удаления")
        if user["role"] in ("admin", "manager"):
            confirmer = user
        else:
            pin = (req.confirm_pin or "").strip()
            cu = await db.users.find_one({"pin": pin}) if pin else None
            if not cu or cu.get("role") not in ("admin", "manager"):
                raise HTTPException(status_code=403, detail="Требуется подтверждение администратора (PIN)")
            confirmer = serialize(cu)
        await db.order_corrections.insert_one({
            "order_id": str(o["_id"]),
            "restaurant_id": o.get("restaurant_id") or user["restaurant_id"],
            "item_name": removed.get("name", ""),
            "item_price": removed.get("price", 0),
            "staff_id": confirmer["id"],
            "staff_name": confirmer.get("name", ""),
            "reason": reason,
            "created_at": iso(now_utc()),
        })
    items.pop(idx)
    void_job = None
    if removed.get("print_status") == "printed" and removed.get("workshop_id"):
        printer = await db.printers.find_one({"workshop_id": removed.get("workshop_id"), "active": True, "restaurant_id": o.get("restaurant_id")})
        if printer:
            void_job = await make_job(o, printer, "void", [removed])
    if not items:
        await db.orders.delete_one({"_id": o["_id"]})
        return {"success": True, "void_job": void_job, "order": None, "deleted": True}
    items, subtotal = calc_items(items)
    await db.orders.update_one(
        {"_id": o["_id"]},
        {"$set": {"items": items, "subtotal": subtotal, "total": round(subtotal - o.get("discount", 0), 2)}},
    )
    return {"success": True, "void_job": void_job, "deleted": False,
            "order": serialize(await db.orders.find_one({"_id": o["_id"]}))}


@api.post("/orders/{oid}/move")
async def move_order(oid: str, req: MoveReq, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    await db.orders.update_one({"_id": o["_id"]}, {"$set": {"table_id": req.table_id}})
    return serialize(await db.orders.find_one({"_id": o["_id"]}))


@api.post("/orders/{oid}/split")
async def split_order(oid: str, req: SplitReq, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid), "restaurant_id": user["restaurant_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    idxset = set(req.indices)
    new_items, remaining = [], []
    for i, it in enumerate(o["items"]):
        (new_items if i in idxset else remaining).append(it)
    if not new_items:
        raise HTTPException(status_code=400, detail="Не выбраны позиции для разделения")
    if not remaining:
        raise HTTPException(status_code=400, detail="Нельзя перенести весь счёт — используйте оплату")
    new_items, new_sub = calc_items(new_items)
    remaining, rem_sub = calc_items(remaining)
    await db.orders.update_one(
        {"_id": o["_id"]},
        {"$set": {"items": remaining, "subtotal": rem_sub, "total": round(rem_sub - o.get("discount", 0), 2)}},
    )
    new_doc = {
        "table_id": o.get("table_id"),
        "restaurant_id": o.get("restaurant_id") or user["restaurant_id"],
        "waiter_id": o.get("waiter_id"),
        "waiter_name": o.get("waiter_name", ""),
        "items": new_items,
        "subtotal": new_sub,
        "discount": 0.0,
        "total": new_sub,
        "status": "open",
        "note": "Разделённый счёт",
        "shift_id": o.get("shift_id"),
        "created_at": iso(now_utc()),
    }
    res = await db.orders.insert_one(new_doc)
    return {
        "original": serialize(await db.orders.find_one({"_id": o["_id"]})),
        "split": serialize(await db.orders.find_one({"_id": res.inserted_id})),
    }


# ----- Agent bridge API (auth via X-Agent-Key) -----
async def get_agent(request: Request) -> dict:
    key = request.headers.get("X-Agent-Key")
    agent = await db.print_agents.find_one({"api_key": key}) if key else None
    if not agent:
        raise HTTPException(status_code=401, detail="Неверный ключ агента")
    return agent


@api.get("/agent/printers")
async def agent_printers(agent: dict = Depends(get_agent)):
    return await list_docs("printers", rid=agent.get("restaurant_id"))


@api.get("/agent/print-jobs")
async def agent_fetch_jobs(agent: dict = Depends(get_agent)):
    jobs = await db.print_jobs.find({"status": "pending", "restaurant_id": agent.get("restaurant_id")}).sort("created_at", 1).to_list(50)
    out = []
    for j in jobs:
        r = await db.print_jobs.update_one(
            {"_id": j["_id"], "status": "pending"},
            {"$set": {"status": "sent", "sent_at": iso(now_utc())}},
        )
        if r.modified_count:
            out.append(serialize({**j, "status": "sent"}))
    return out


@api.patch("/agent/print-jobs/{jid}")
async def agent_report_job(jid: str, req: JobReport, agent: dict = Depends(get_agent)):
    upd = {"status": req.status}
    if req.status == "printed":
        upd["printed_at"] = iso(now_utc())
    if req.status == "failed":
        upd["error_message"] = req.error_message
    await db.print_jobs.update_one({"_id": parse_oid(jid), "restaurant_id": agent.get("restaurant_id")}, {"$set": upd, "$inc": {"attempts": 1}})
    return {"success": True}


@api.post("/agent/heartbeat")
async def agent_heartbeat(req: HeartbeatReq, agent: dict = Depends(get_agent)):
    await db.print_agents.update_one({"_id": agent["_id"]}, {"$set": {"last_heartbeat_at": iso(now_utc())}})
    for pid, status in (req.printers or {}).items():
        if ObjectId.is_valid(pid):
            await db.printers.update_one(
                {"_id": ObjectId(pid), "restaurant_id": agent.get("restaurant_id")}, {"$set": {"status": status, "last_seen_at": iso(now_utc())}}
            )
    return {"success": True}


@api.post("/agent/emulate")
async def emulate_agent(user: dict = Depends(require_roles("manager"))):
    """Симуляция локального агента: печатает все ожидающие задания (для демо в облаке)."""
    jobs = await db.print_jobs.find({"status": {"$in": ["pending", "sent"]}, "restaurant_id": user["restaurant_id"]}).sort("created_at", 1).to_list(100)
    processed = []
    for j in jobs:
        await db.print_jobs.update_one(
            {"_id": j["_id"]},
            {"$set": {"status": "printed", "sent_at": j.get("sent_at") or iso(now_utc()),
                      "printed_at": iso(now_utc())}, "$inc": {"attempts": 1}},
        )
        j2 = serialize(j)
        j2["status"] = "printed"
        processed.append(j2)
    await db.printers.update_many({"restaurant_id": user["restaurant_id"]}, {"$set": {"status": "online", "last_seen_at": iso(now_utc())}})
    return {"processed": len(processed), "jobs": processed}


# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def seed():
    await db.users.create_index("pin", sparse=True)
    await db.stock.create_index(
        [("restaurant_id", 1), ("inventory_id", 1), ("warehouse_id", 1)], unique=True)

    # --- Мультитенантность: дефолтное заведение (restaurant_id) ---
    global _default_rid_cache
    rest = await db.restaurants.find_one({"is_default": True})
    if not rest:
        res = await db.restaurants.insert_one({
            "name": "Мята Спортивная", "is_default": True, "created_at": iso(now_utc())})
        rest = await db.restaurants.find_one({"_id": res.inserted_id})
    default_rid = str(rest["_id"])
    _default_rid_cache = default_rid

    # --- Задача 0: одноразовая миграция ролей (old admin->manager, old cashier->admin) ---
    if not await db.settings.find_one({"key": "role_migration_v1"}):
        await db.users.update_many({"role": "admin"}, {"$set": {"role": "manager"}})
        await db.users.update_many({"role": "cashier"}, {"$set": {"role": "admin"}})
        await db.settings.update_one({"key": "role_migration_v1"},
                                     {"$set": {"key": "role_migration_v1", "done_at": iso(now_utc())}}, upsert=True)

    # Задача 0: привести имена демо-персонала в соответствие с новыми ролями (одноразово)
    if not await db.settings.find_one({"key": "role_names_v1"}):
        await db.users.update_one({"pin": "2222"}, {"$set": {"name": "Администратор Мария"}})
        await db.users.update_many({"role": "manager", "name": "Администратор"}, {"$set": {"name": "Менеджер"}})
        await db.settings.update_one({"key": "role_names_v1"},
                                     {"$set": {"key": "role_names_v1", "done_at": iso(now_utc())}}, upsert=True)

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@resto.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "name": "Менеджер", "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "manager", "created_at": iso(now_utc()),
        })
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password)}})

    # demo staff
    if not await db.users.find_one({"pin": "1111"}):
        await db.users.insert_one({"name": "Официант Иван", "role": "waiter",
                                   "pin": "1111", "created_at": iso(now_utc())})
    if not await db.users.find_one({"pin": "2222"}):
        await db.users.insert_one({"name": "Администратор Мария", "role": "admin",
                                   "pin": "2222", "created_at": iso(now_utc())})

    # demo data only if empty
    if await db.workshops.count_documents({}) == 0:
        kitchen = await db.workshops.insert_one({"name": "Кухня", "color": "#FF5A00", "created_at": iso(now_utc())})
        bar = await db.workshops.insert_one({"name": "Бар", "color": "#00E5FF", "created_at": iso(now_utc())})
        kitchen_id, bar_id = str(kitchen.inserted_id), str(bar.inserted_id)

        c1 = await db.categories.insert_one({"name": "Бургеры", "color": "#FF5A00", "position": 1, "created_at": iso(now_utc())})
        c2 = await db.categories.insert_one({"name": "Напитки", "color": "#00E5FF", "position": 2, "created_at": iso(now_utc())})
        c3 = await db.categories.insert_one({"name": "Салаты", "color": "#00E676", "position": 3, "created_at": iso(now_utc())})
        cid1, cid2, cid3 = str(c1.inserted_id), str(c2.inserted_id), str(c3.inserted_id)

        demo_products = [
            ("Классический бургер", cid1, kitchen_id, 12.5, "pcs"),
            ("Чизбургер", cid1, kitchen_id, 14.0, "pcs"),
            ("Двойной бургер", cid1, kitchen_id, 18.0, "pcs"),
            ("Кола 0.5л", cid2, bar_id, 3.0, "pcs"),
            ("Латте", cid2, bar_id, 4.5, "pcs"),
            ("Сок апельсиновый", cid2, bar_id, 4.0, "pcs"),
            ("Цезарь", cid3, kitchen_id, 10.0, "pcs"),
            ("Греческий салат", cid3, kitchen_id, 9.0, "pcs"),
        ]
        for name, cat, ws, price, m in demo_products:
            await db.products.insert_one({"name": name, "category_id": cat, "workshop_id": ws,
                                          "price": price, "cost": round(price * 0.4, 2), "measure": m,
                                          "image": None, "for_sale": True, "created_at": iso(now_utc())})

        for i in range(1, 9):
            await db.tables.insert_one({"name": f"Стол {i}", "hall": "Основной зал",
                                        "seats": 4, "created_at": iso(now_utc())})

        inv_ids = {}
        for name, m, bal, cost in [("Говядина", "kg", 20, 8.0), ("Булочки", "pcs", 100, 0.3),
                                    ("Сыр", "kg", 10, 6.0), ("Кофе зерно", "kg", 5, 15.0)]:
            r = await db.inventory.insert_one({"name": name, "measure": m, "balance": bal,
                                               "cost": cost, "created_at": iso(now_utc())})
            inv_ids[name] = str(r.inserted_id)

        # demo recipes (тех.карты) — auto write-off on sale
        recipe_map = {
            "Классический бургер": [("Булочки", 1), ("Говядина", 0.15)],
            "Чизбургер": [("Булочки", 1), ("Говядина", 0.15), ("Сыр", 0.03)],
            "Двойной бургер": [("Булочки", 1), ("Говядина", 0.30), ("Сыр", 0.03)],
            "Латте": [("Кофе зерно", 0.018)],
        }
        for pname, ings in recipe_map.items():
            recipe = [{"inventory_id": inv_ids[n], "name": n, "amount": a} for n, a in ings]
            await db.products.update_one({"name": pname}, {"$set": {"recipe": recipe}})

        # demo printers (цех = станция печати) — реальное оборудование заведения
        await db.printers.insert_one({"name": "Кухня", "station": "kitchen", "workshop_id": kitchen_id,
                                      "local_ip": "192.168.0.112", "port": 9100, "codepage_label": "cp866",
                                      "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                      "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})
        await db.printers.insert_one({"name": "Бар", "station": "bar", "workshop_id": bar_id,
                                      "local_ip": "192.168.0.111", "port": 9100, "codepage_label": "cp866",
                                      "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                      "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})
        await db.printers.insert_one({"name": "Касса (пречек)", "station": "precheck", "workshop_id": None,
                                      "local_ip": "192.168.0.111", "port": 9100, "codepage_label": "cp866",
                                      "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                      "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})

    if await db.print_agents.count_documents({}) == 0:
        await db.print_agents.insert_one({"name": "Мост — зал 1 этаж", "api_key": secrets.token_hex(24),
                                          "last_heartbeat_at": None, "created_at": iso(now_utc())})

    # idempotent: ensure printers + recipes exist even on a pre-existing DB
    if await db.printers.count_documents({}) == 0:
        ws = {w["name"]: w["id"] for w in await list_docs("workshops")}
        if "Кухня" in ws:
            await db.printers.insert_one({"name": "Кухня", "station": "kitchen", "workshop_id": ws["Кухня"],
                                          "local_ip": "192.168.0.112", "port": 9100, "codepage_label": "cp866",
                                          "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                          "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})
        if "Бар" in ws:
            await db.printers.insert_one({"name": "Бар", "station": "bar", "workshop_id": ws["Бар"],
                                          "local_ip": "192.168.0.111", "port": 9100, "codepage_label": "cp866",
                                          "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                          "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})
        await db.printers.insert_one({"name": "Касса (пречек)", "station": "precheck", "workshop_id": None,
                                      "local_ip": "192.168.0.111", "port": 9100, "codepage_label": "cp866",
                                      "escape_t_value": 17, "paper_width_mm": 80, "active": True,
                                      "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())})

    # migrate legacy printer docs to escape_t_value model + real hardware IPs (из брифа)
    ip_map = {"Кухня": "192.168.0.112", "Бар": "192.168.0.111", "Касса (пречек)": "192.168.0.111"}
    async for p in db.printers.find({}):
        upd = {}
        if "escape_t_value" not in p:
            upd["escape_t_value"] = 17
        if "codepage_label" not in p:
            upd["codepage_label"] = (p.get("codepage") or "cp866").lower()
        if p.get("name") in ip_map and p.get("local_ip") != ip_map[p["name"]]:
            upd["local_ip"] = ip_map[p["name"]]
        if upd:
            await db.printers.update_one({"_id": p["_id"]}, {"$set": upd})

    if await db.products.count_documents({"recipe": {"$exists": True, "$ne": []}}) == 0:
        inv = {i["name"]: i["id"] for i in await list_docs("inventory")}
        recipe_map = {
            "Классический бургер": [("Булочки", 1), ("Говядина", 0.15)],
            "Чизбургер": [("Булочки", 1), ("Говядина", 0.15), ("Сыр", 0.03)],
            "Двойной бургер": [("Булочки", 1), ("Говядина", 0.30), ("Сыр", 0.03)],
            "Латте": [("Кофе зерно", 0.018)],
        }
        for pname, ings in recipe_map.items():
            recipe = [{"inventory_id": inv[n], "name": n, "amount": a} for n, a in ings if n in inv]
            if recipe:
                await db.products.update_one({"name": pname}, {"$set": {"recipe": recipe}})

    # --- Задача 2: склады + миграция остатков на дефолтный склад ---
    if await db.warehouses.count_documents({"restaurant_id": default_rid}) == 0:
        ws = {w["name"]: w["id"] for w in await list_docs("workshops", rid=default_rid)}
        wk = await db.warehouses.insert_one({
            "name": "Склад Кухня", "workshop_id": ws.get("Кухня"), "is_default": True,
            "restaurant_id": default_rid, "created_at": iso(now_utc())})
        await db.warehouses.insert_one({
            "name": "Склад Бар", "workshop_id": ws.get("Бар"), "is_default": False,
            "restaurant_id": default_rid, "created_at": iso(now_utc())})
        default_wh = str(wk.inserted_id)
        # перенос текущих остатков inventory.balance на дефолтный склад
        async for it in db.inventory.find({"restaurant_id": default_rid}):
            bal = it.get("balance", 0) or 0
            existing = await db.stock.find_one(
                {"restaurant_id": default_rid, "inventory_id": str(it["_id"])})
            if not existing and bal:
                await db.stock.insert_one({
                    "restaurant_id": default_rid, "inventory_id": str(it["_id"]),
                    "warehouse_id": default_wh, "quantity": bal})

    # cost_source по умолчанию для существующих блюд
    await db.products.update_many(
        {"cost_source": {"$exists": False}}, {"$set": {"cost_source": "manual"}})

    # --- Задача 3/4: демо-модификаторы и демо-клиент (идемпотентно) ---
    if await db.modifier_groups.count_documents({"restaurant_id": default_rid}) == 0:
        cheese = await db.inventory.find_one({"restaurant_id": default_rid, "name": "Сыр"})
        g = await db.modifier_groups.insert_one({
            "name": "Добавки", "selection_type": "multiple", "min_count": 0, "max_count": 3,
            "restaurant_id": default_rid, "created_at": iso(now_utc())})
        gid = str(g.inserted_id)
        opts = [
            {"name": "Доп. сыр", "price_delta": 1.5,
             "inventory_id": str(cheese["_id"]) if cheese else None, "amount": 0.02 if cheese else None},
            {"name": "Бекон", "price_delta": 2.0, "inventory_id": None, "amount": None},
            {"name": "Без лука", "price_delta": 0.0, "inventory_id": None, "amount": None},
        ]
        for o in opts:
            await db.modifier_options.insert_one({**o, "group_id": gid, "restaurant_id": default_rid, "created_at": iso(now_utc())})
        await db.products.update_many(
            {"restaurant_id": default_rid, "name": {"$in": ["Классический бургер", "Чизбургер", "Двойной бургер"]}},
            {"$set": {"modifier_group_ids": [gid]}})

    if await db.clients.count_documents({"restaurant_id": default_rid}) == 0:
        await db.clients.insert_one({
            "name": "Иван Петров", "phone": "+7 900 123-45-67", "phone_digits": "79001234567",
            "discount_percent": 10.0, "bonus_balance": 100.0, "restaurant_id": default_rid, "created_at": iso(now_utc())})

    # --- Задача 6: демо группа лояльности, привязка и акция (идемпотентно) ---
    await db.clients.update_many(
        {"restaurant_id": default_rid, "bonus_balance": {"$exists": False}}, {"$set": {"bonus_balance": 0.0}})
    if await db.loyalty_groups.count_documents({"restaurant_id": default_rid}) == 0:
        lg = await db.loyalty_groups.insert_one({
            "name": "Бонусный клуб", "type": "bonus", "value_percent": 5.0,
            "restaurant_id": default_rid, "created_at": iso(now_utc())})
        await db.clients.update_many(
            {"restaurant_id": default_rid, "name": "Иван Петров"},
            {"$set": {"loyalty_group_id": str(lg.inserted_id)}})
    if await db.promotions.count_documents({"restaurant_id": default_rid}) == 0:
        await db.promotions.insert_one({
            "name": "Счастливые часы −15%", "active": True, "weekdays": [],
            "time_from": "14:00", "time_to": "17:00", "date_from": None, "date_to": None,
            "condition_items": [], "result_type": "discount_percent", "result_value": 15.0,
            "result_product_id": None, "auto_apply": True, "stackable": False,
            "restaurant_id": default_rid, "created_at": iso(now_utc())})

    # settings: дефолтный лимит оплаты бонусами
    await db.settings.update_one(
        {"key": "venue", "max_bonus_payment_percent": {"$exists": False}},
        {"$set": {"max_bonus_payment_percent": 50}})

    # --- Задача 14: способы оплаты по умолчанию + бэкфилл долга клиентов ---
    if await db.payment_methods.count_documents({"restaurant_id": default_rid}) == 0:
        await db.payment_methods.insert_one({"name": "Наличные", "code": "cash", "is_debt": False, "active": True, "position": 1, "restaurant_id": default_rid, "created_at": iso(now_utc())})
        await db.payment_methods.insert_one({"name": "Карта", "code": "card", "is_debt": False, "active": True, "position": 2, "restaurant_id": default_rid, "created_at": iso(now_utc())})
        await db.payment_methods.insert_one({"name": "В долг", "code": "debt", "is_debt": True, "active": True, "position": 3, "restaurant_id": default_rid, "created_at": iso(now_utc())})
    await db.clients.update_many(
        {"restaurant_id": default_rid, "debt_balance": {"$exists": False}}, {"$set": {"debt_balance": 0.0}})

    # --- Задача 12: демо быстрые комментарии ---
    if await db.quick_comments.count_documents({"restaurant_id": default_rid}) == 0:
        for ctx, txt in [("dish", "Без соли"), ("dish", "Острое"), ("dish", "Без лука"),
                         ("order", "Приборы отдельно"), ("order", "Подать сразу"),
                         ("cancel", "Гость ушёл"), ("cancel", "Ошибка официанта")]:
            await db.quick_comments.insert_one({"context": ctx, "text": txt,
                                                "restaurant_id": default_rid, "created_at": iso(now_utc())})

    # --- Задача 15: курсы подачи по умолчанию (Салаты=1, Бургеры=2, Напитки=0) ---
    await db.categories.update_many(
        {"restaurant_id": default_rid, "course_number": {"$exists": False}}, {"$set": {"course_number": 0}})

    # Мультитенантность: бэкфилл restaurant_id на все существующие/сид-документы, где его нет
    tenant_collections = ["users", "workshops", "categories", "products", "tables",
                          "inventory", "suppliers", "invoices", "writeoffs", "orders",
                          "shifts", "printers", "print_agents", "print_jobs", "order_corrections",
                          "payment_methods", "quick_comments", "cash_movements", "debt_transactions"]
    for c in tenant_collections:
        await db[c].update_many({"restaurant_id": {"$exists": False}},
                                {"$set": {"restaurant_id": default_rid}})

    logger.info("Seed complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()
