from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict, field_validator
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, timedelta, date
from bson import ObjectId
import logging
import time
import base64
import secrets
import bcrypt
import jwt
from collections import defaultdict

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


def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": now_utc() + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


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


class WorkshopReq(BaseModel):
    name: str
    color: Optional[str] = "#00E5FF"


class CategoryReq(BaseModel):
    name: str
    color: Optional[str] = "#FF5A00"
    position: int = 0


class RecipeIngredient(BaseModel):
    inventory_id: str
    name: str
    amount: float


class ProductReq(BaseModel):
    name: str
    category_id: Optional[str] = None
    workshop_id: Optional[str] = None
    price: float = 0.0
    cost: float = 0.0
    measure: str = "pcs"
    image: Optional[str] = None
    for_sale: bool = True
    recipe: List[RecipeIngredient] = []


class TableReq(BaseModel):
    name: str
    hall: str = "Основной зал"
    seats: int = 4


class StaffReq(BaseModel):
    name: str
    role: str  # waiter | cashier | admin
    pin: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None


class OrderItemReq(BaseModel):
    product_id: str
    name: str
    price: float
    count: float = 1
    workshop_id: Optional[str] = None
    print_status: str = "pending"
    print_job_id: Optional[str] = None


class OrderCreateReq(BaseModel):
    table_id: Optional[str] = None
    items: List[OrderItemReq] = []


class OrderUpdateReq(BaseModel):
    items: List[OrderItemReq]


class PaymentReq(BaseModel):
    payment_method: str = "cash"  # cash | card
    discount: float = 0.0


class SupplierReq(BaseModel):
    name: str
    phone: Optional[str] = ""


class InventoryItemReq(BaseModel):
    name: str
    measure: str = "kg"
    balance: float = 0.0
    cost: float = 0.0


class InvoiceItemReq(BaseModel):
    inventory_id: str
    name: str
    amount: float
    price: float


class InvoiceReq(BaseModel):
    number: str
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = ""
    items: List[InvoiceItemReq] = []


class WriteOffReq(BaseModel):
    inventory_id: str
    amount: float
    reason: str = "Списание"


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


class SplitReq(BaseModel):
    indices: List[int]


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
        token = create_token(str(user["_id"]), user["role"])
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
        token = create_token(str(user["_id"]), user["role"])
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
async def list_docs(coll, query=None, sort=None):
    cursor = db[coll].find(query or {})
    if sort:
        cursor = cursor.sort(sort)
    docs = await cursor.to_list(2000)
    return [serialize(d) for d in docs]


# ----- Workshops (Цеха) -----
@api.get("/workshops")
async def get_workshops(user: dict = Depends(get_current_user)):
    return await list_docs("workshops")


@api.post("/workshops")
async def create_workshop(req: WorkshopReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.workshops.insert_one(doc)
    return serialize(await db.workshops.find_one({"_id": res.inserted_id}))


@api.put("/workshops/{wid}")
async def update_workshop(wid: str, req: WorkshopReq, user: dict = Depends(require_roles("admin"))):
    await db.workshops.update_one({"_id": parse_oid(wid)}, {"$set": req.model_dump()})
    return serialize(await db.workshops.find_one({"_id": parse_oid(wid)}))


@api.delete("/workshops/{wid}")
async def delete_workshop(wid: str, user: dict = Depends(require_roles("admin"))):
    await db.workshops.delete_one({"_id": parse_oid(wid)})
    return {"success": True}


# ----- Categories -----
@api.get("/categories")
async def get_categories(user: dict = Depends(get_current_user)):
    return await list_docs("categories", sort=[("position", 1)])


@api.post("/categories")
async def create_category(req: CategoryReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.categories.insert_one(doc)
    return serialize(await db.categories.find_one({"_id": res.inserted_id}))


@api.put("/categories/{cid}")
async def update_category(cid: str, req: CategoryReq, user: dict = Depends(require_roles("admin"))):
    await db.categories.update_one({"_id": parse_oid(cid)}, {"$set": req.model_dump()})
    return serialize(await db.categories.find_one({"_id": parse_oid(cid)}))


@api.delete("/categories/{cid}")
async def delete_category(cid: str, user: dict = Depends(require_roles("admin"))):
    await db.categories.delete_one({"_id": parse_oid(cid)})
    return {"success": True}


# ----- Products -----
@api.get("/products")
async def get_products(user: dict = Depends(get_current_user)):
    return await list_docs("products", sort=[("name", 1)])


@api.post("/products")
async def create_product(req: ProductReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.products.insert_one(doc)
    return serialize(await db.products.find_one({"_id": res.inserted_id}))


@api.put("/products/{pid}")
async def update_product(pid: str, req: ProductReq, user: dict = Depends(require_roles("admin"))):
    await db.products.update_one({"_id": parse_oid(pid)}, {"$set": req.model_dump()})
    return serialize(await db.products.find_one({"_id": parse_oid(pid)}))


@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_roles("admin"))):
    await db.products.delete_one({"_id": parse_oid(pid)})
    return {"success": True}


# ----- Tables -----
@api.get("/tables")
async def get_tables(user: dict = Depends(get_current_user)):
    tables = await list_docs("tables", sort=[("name", 1)])
    open_orders = await db.orders.find({"status": {"$in": ["open", "sent"]}}).to_list(2000)
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
async def create_table(req: TableReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.tables.insert_one(doc)
    return serialize(await db.tables.find_one({"_id": res.inserted_id}))


@api.put("/tables/{tid}")
async def update_table(tid: str, req: TableReq, user: dict = Depends(require_roles("admin"))):
    await db.tables.update_one({"_id": parse_oid(tid)}, {"$set": req.model_dump()})
    return serialize(await db.tables.find_one({"_id": parse_oid(tid)}))


@api.delete("/tables/{tid}")
async def delete_table(tid: str, user: dict = Depends(require_roles("admin"))):
    await db.tables.delete_one({"_id": parse_oid(tid)})
    return {"success": True}


# ----- Staff -----
@api.get("/staff")
async def get_staff(user: dict = Depends(require_roles("admin"))):
    users = await db.users.find({}).to_list(2000)
    out = []
    for u in users:
        u = serialize(u)
        u.pop("password_hash", None)
        out.append(u)
    return out


@api.post("/staff")
async def create_staff(req: StaffReq, user: dict = Depends(require_roles("admin"))):
    doc = {"name": req.name, "role": req.role, "created_at": iso(now_utc())}
    if req.role in ("waiter", "cashier"):
        if not req.pin:
            raise HTTPException(status_code=400, detail="PIN обязателен для официанта/кассира")
        if await db.users.find_one({"pin": req.pin}):
            raise HTTPException(status_code=400, detail="Такой PIN уже используется")
        doc["pin"] = req.pin
    if req.role == "admin":
        if not req.email or not req.password:
            raise HTTPException(status_code=400, detail="Email и пароль обязательны для админа")
        doc["email"] = req.email.strip().lower()
        doc["password_hash"] = hash_password(req.password)
    res = await db.users.insert_one(doc)
    u = serialize(await db.users.find_one({"_id": res.inserted_id}))
    u.pop("password_hash", None)
    return u


@api.put("/staff/{sid}")
async def update_staff(sid: str, req: StaffReq, user: dict = Depends(require_roles("admin"))):
    update = {"name": req.name, "role": req.role}
    if req.pin:
        existing = await db.users.find_one({"pin": req.pin, "_id": {"$ne": parse_oid(sid)}})
        if existing:
            raise HTTPException(status_code=400, detail="Такой PIN уже используется")
        update["pin"] = req.pin
    if req.email:
        update["email"] = req.email.strip().lower()
    if req.password:
        update["password_hash"] = hash_password(req.password)
    await db.users.update_one({"_id": parse_oid(sid)}, {"$set": update})
    u = serialize(await db.users.find_one({"_id": parse_oid(sid)}))
    u.pop("password_hash", None)
    return u


@api.delete("/staff/{sid}")
async def delete_staff(sid: str, user: dict = Depends(require_roles("admin"))):
    if sid == user["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    await db.users.delete_one({"_id": parse_oid(sid)})
    return {"success": True}


# ---------------------------------------------------------------------------
# SHIFTS (Смены)
# ---------------------------------------------------------------------------
@api.get("/shifts/current")
async def current_shift(user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open"})
    return serialize(shift) if shift else None


@api.post("/shifts/open")
async def open_shift(user: dict = Depends(require_roles("cashier", "admin"))):
    existing = await db.shifts.find_one({"status": "open"})
    if existing:
        return serialize(existing)
    doc = {
        "status": "open",
        "opened_by": user["id"],
        "opened_by_name": user.get("name", ""),
        "opened_at": iso(now_utc()),
    }
    res = await db.shifts.insert_one(doc)
    return serialize(await db.shifts.find_one({"_id": res.inserted_id}))


@api.post("/shifts/close")
async def close_shift(user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open"})
    if not shift:
        raise HTTPException(status_code=400, detail="Нет открытой смены")
    open_count = await db.orders.count_documents({"status": {"$in": ["open", "sent"]}, "shift_id": str(shift["_id"])})
    if open_count > 0:
        raise HTTPException(status_code=400, detail=f"Есть незакрытые заказы ({open_count}). Оплатите или отмените их перед закрытием смены.")
    orders = await db.orders.find({"shift_id": str(shift["_id"]), "status": "closed"}).to_list(5000)
    total = sum(o.get("total", 0) for o in orders)
    cash = sum(o.get("total", 0) for o in orders if o.get("payment_method") == "cash")
    card = sum(o.get("total", 0) for o in orders if o.get("payment_method") == "card")
    await db.shifts.update_one(
        {"_id": shift["_id"]},
        {"$set": {
            "status": "closed",
            "closed_by": user["id"],
            "closed_at": iso(now_utc()),
            "total_sales": round(total, 2),
            "total_cash": round(cash, 2),
            "total_card": round(card, 2),
            "orders_count": len(orders),
        }},
    )
    return serialize(await db.shifts.find_one({"_id": shift["_id"]}))


@api.get("/shifts")
async def list_shifts(user: dict = Depends(require_roles("admin"))):
    return await list_docs("shifts", sort=[("opened_at", -1)])


# ---------------------------------------------------------------------------
# ORDERS
# ---------------------------------------------------------------------------
def calc_items(items: List[dict]):
    for it in items:
        it["total"] = round(it["price"] * it["count"], 2)
    subtotal = round(sum(it["total"] for it in items), 2)
    return items, subtotal


@api.get("/orders")
async def get_orders(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {}
    if status:
        q["status"] = status
    return await list_docs("orders", q, sort=[("created_at", -1)])


@api.get("/orders/{oid}")
async def get_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    return serialize(o)


@api.post("/orders")
async def create_order(req: OrderCreateReq, user: dict = Depends(get_current_user)):
    shift = await db.shifts.find_one({"status": "open"})
    if not shift:
        raise HTTPException(status_code=400, detail="Смена не открыта. Откройте смену.")
    items = [i.model_dump() for i in req.items]
    items, subtotal = calc_items(items)
    doc = {
        "table_id": req.table_id,
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
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    items = [i.model_dump() for i in req.items]
    items, subtotal = calc_items(items)
    total = round(subtotal - o.get("discount", 0), 2)
    await db.orders.update_one(
        {"_id": parse_oid(oid)},
        {"$set": {"items": items, "subtotal": subtotal, "total": total}},
    )
    return serialize(await db.orders.find_one({"_id": parse_oid(oid)}))


@api.post("/orders/{oid}/send")
async def send_order(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    items = o["items"]
    pending_idx = [i for i, it in enumerate(items) if it.get("print_status", "pending") != "printed"]
    workshops = {w["id"]: w for w in await list_docs("workshops")}
    groups = {}
    for i in pending_idx:
        groups.setdefault(items[i].get("workshop_id") or "none", []).append(i)
    tickets = {}
    jobs = []
    for wid, idxs in groups.items():
        grp_items = [items[i] for i in idxs]
        wname = workshops.get(wid, {}).get("name", "Без цеха")
        tickets[wname] = [{"name": items[i]["name"], "count": items[i]["count"]} for i in idxs]
        printer = await db.printers.find_one({"workshop_id": wid, "active": True}) if wid != "none" else None
        if printer:
            job = await make_job(o, printer, "ticket", grp_items)
            jobs.append(job)
            for i in idxs:
                items[i]["print_job_id"] = job["id"]
        for i in idxs:
            items[i]["print_status"] = "printed"
    await db.orders.update_one(
        {"_id": parse_oid(oid)},
        {"$set": {"items": items, "status": "sent", "sent_at": iso(now_utc())}},
    )
    return {"success": True, "tickets": tickets, "jobs": jobs}


@api.post("/orders/{oid}/pay")
async def pay_order(oid: str, req: PaymentReq, user: dict = Depends(require_roles("cashier", "admin"))):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже оплачен")
    total = round(o["subtotal"] - req.discount, 2)
    await db.orders.update_one(
        {"_id": parse_oid(oid)},
        {"$set": {
            "status": "closed",
            "discount": req.discount,
            "total": total,
            "payment_method": req.payment_method,
            "cashier_id": user["id"],
            "cashier_name": user.get("name", ""),
            "closed_at": iso(now_utc()),
        }},
    )
    # auto write-off ingredients by recipe (тех.карты)
    for it in o["items"]:
        pid = it.get("product_id", "")
        if not ObjectId.is_valid(pid):
            continue
        prod = await db.products.find_one({"_id": ObjectId(pid)})
        if not prod:
            continue
        for ing in prod.get("recipe", []):
            amt = round(ing["amount"] * it["count"], 4)
            if amt <= 0 or not ObjectId.is_valid(ing["inventory_id"]):
                continue
            await db.inventory.update_one(
                {"_id": ObjectId(ing["inventory_id"])}, {"$inc": {"balance": -amt}}
            )
            await db.writeoffs.insert_one({
                "inventory_id": ing["inventory_id"], "name": ing["name"], "amount": amt,
                "reason": f"Продажа: {it['name']}", "created_by": user.get("name", ""),
                "created_at": iso(now_utc()),
            })
    return serialize(await db.orders.find_one({"_id": parse_oid(oid)}))


@api.delete("/orders/{oid}")
async def delete_order(oid: str, user: dict = Depends(get_current_user)):
    res = await db.orders.delete_one({"_id": parse_oid(oid), "status": {"$ne": "closed"}})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Заказ не найден или уже закрыт")
    return {"success": True}


# ---------------------------------------------------------------------------
# INVENTORY / WAREHOUSE (Склад)
# ---------------------------------------------------------------------------
@api.get("/inventory")
async def get_inventory(user: dict = Depends(get_current_user)):
    return await list_docs("inventory", sort=[("name", 1)])


@api.post("/inventory")
async def create_inventory(req: InventoryItemReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.inventory.insert_one(doc)
    return serialize(await db.inventory.find_one({"_id": res.inserted_id}))


@api.put("/inventory/{iid}")
async def update_inventory(iid: str, req: InventoryItemReq, user: dict = Depends(require_roles("admin"))):
    await db.inventory.update_one({"_id": parse_oid(iid)}, {"$set": req.model_dump()})
    return serialize(await db.inventory.find_one({"_id": parse_oid(iid)}))


@api.delete("/inventory/{iid}")
async def delete_inventory(iid: str, user: dict = Depends(require_roles("admin"))):
    await db.inventory.delete_one({"_id": parse_oid(iid)})
    return {"success": True}


@api.get("/suppliers")
async def get_suppliers(user: dict = Depends(get_current_user)):
    return await list_docs("suppliers", sort=[("name", 1)])


@api.post("/suppliers")
async def create_supplier(req: SupplierReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "created_at": iso(now_utc())}
    res = await db.suppliers.insert_one(doc)
    return serialize(await db.suppliers.find_one({"_id": res.inserted_id}))


@api.delete("/suppliers/{sid}")
async def delete_supplier(sid: str, user: dict = Depends(require_roles("admin"))):
    await db.suppliers.delete_one({"_id": parse_oid(sid)})
    return {"success": True}


@api.get("/invoices")
async def get_invoices(user: dict = Depends(get_current_user)):
    return await list_docs("invoices", sort=[("created_at", -1)])


@api.post("/invoices")
async def create_invoice(req: InvoiceReq, user: dict = Depends(require_roles("admin"))):
    if await db.invoices.find_one({"number": req.number}):
        raise HTTPException(status_code=400, detail="Накладная с таким номером уже существует")
    items = [i.model_dump() for i in req.items]
    total = round(sum(i["amount"] * i["price"] for i in items), 2)
    doc = {
        "number": req.number,
        "supplier_id": req.supplier_id,
        "supplier_name": req.supplier_name,
        "items": items,
        "total": total,
        "created_by": user.get("name", ""),
        "created_at": iso(now_utc()),
    }
    res = await db.invoices.insert_one(doc)
    # increase stock balances
    for it in items:
        await db.inventory.update_one(
            {"_id": parse_oid(it["inventory_id"])},
            {"$inc": {"balance": it["amount"]}, "$set": {"cost": it["price"]}},
        )
    return serialize(await db.invoices.find_one({"_id": res.inserted_id}))


@api.get("/writeoffs")
async def get_writeoffs(user: dict = Depends(get_current_user)):
    return await list_docs("writeoffs", sort=[("created_at", -1)])


@api.post("/writeoffs")
async def create_writeoff(req: WriteOffReq, user: dict = Depends(require_roles("admin"))):
    inv = await db.inventory.find_one({"_id": parse_oid(req.inventory_id)})
    if not inv:
        raise HTTPException(status_code=404, detail="Позиция склада не найдена")
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Количество должно быть больше нуля")
    if req.amount > inv.get("balance", 0):
        raise HTTPException(status_code=400, detail=f"Недостаточно остатка (есть {inv.get('balance', 0)})")
    doc = {
        "inventory_id": req.inventory_id,
        "name": inv["name"],
        "amount": req.amount,
        "reason": req.reason,
        "created_by": user.get("name", ""),
        "created_at": iso(now_utc()),
    }
    res = await db.writeoffs.insert_one(doc)
    await db.inventory.update_one(
        {"_id": parse_oid(req.inventory_id)}, {"$inc": {"balance": -req.amount}}
    )
    return serialize(await db.writeoffs.find_one({"_id": res.inserted_id}))


# ---------------------------------------------------------------------------
# REPORTS / DASHBOARD
# ---------------------------------------------------------------------------
@api.get("/reports/dashboard")
async def dashboard(user: dict = Depends(require_roles("admin"))):
    today = now_utc().date().isoformat()
    closed = await db.orders.find({"status": "closed"}).to_list(10000)
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
                       user: dict = Depends(require_roles("admin"))):
    closed = await db.orders.find({"status": "closed"}).to_list(10000)
    if start:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] >= start]
    if end:
        closed = [o for o in closed if (o.get("closed_at") or "")[:10] <= end]

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


# ---------------------------------------------------------------------------
# PRINTING — ESC/POS rendering, printers, print jobs, agent bridge API
# ---------------------------------------------------------------------------
def escpos_encode(text: str, codepage_label: str) -> bytes:
    try:
        return text.encode(codepage_label, errors="replace")
    except LookupError:
        return text.encode("cp866", errors="replace")


def render_escpos(lines: List[str], codepage_label: str = "cp866", escape_t_value: int = 17) -> bytes:
    """Собирает ESC/POS буфер. Кодовая страница задаётся ТОЛЬКО полем принтера
    escape_t_value (ESC t <n>) — это эмпирическое число под конкретную модель, а не
    производное от названия кодировки. Кириллица кодируется в codepage_label (cp866)."""
    ESC = b"\x1b"
    GS = b"\x1d"
    buf = bytearray()
    buf += ESC + b"@"                                # init/reset
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


def build_lines(kind: str, table_name: str, waiter: str, items: List[dict], subtotal=None) -> List[str]:
    title = {"ticket": "*** ЗАКАЗ ***", "void": "*** СТОРНО ***", "precheck": "--- ПРЕДЧЕК ---"}[kind]
    lines = [title, f"Стол: {table_name}", f"Официант: {waiter}",
             now_utc().strftime("%d.%m.%Y %H:%M"), "-" * 32]
    for it in items:
        if kind == "precheck":
            total = it.get("total", it["price"] * it["count"])
            lines.append(_pad(f"{it['name']} x{_fmt_count(it['count'])}", f"{total:.2f}"))
        else:
            lines.append(f"{it['name']} x{_fmt_count(it['count'])}")
    if kind == "precheck" and subtotal is not None:
        lines.append("-" * 32)
        lines.append(_pad("ИТОГО:", f"{subtotal:.2f}"))
    return lines


async def _table_name(tid) -> str:
    if not tid or not ObjectId.is_valid(tid):
        return "—"
    t = await db.tables.find_one({"_id": ObjectId(tid)})
    return t["name"] if t else "—"


async def make_job(order: dict, printer: dict, jtype: str, items: List[dict], subtotal=None) -> dict:
    table_name = await _table_name(order.get("table_id"))
    lines = build_lines(jtype, table_name, order.get("waiter_name", ""), items, subtotal)
    codepage_label = printer.get("codepage_label", "cp866")
    escape_t_value = printer.get("escape_t_value", 17)
    payload = base64.b64encode(render_escpos(lines, codepage_label, escape_t_value)).decode()
    doc = {
        "order_id": str(order["_id"]),
        "printer_id": str(printer["_id"]),
        "printer_name": printer["name"],
        "printer_ip": printer.get("local_ip"),
        "printer_port": printer.get("port", 9100),
        "station": printer["station"],
        "type": jtype,
        "payload": payload,
        "text": "\n".join(lines),
        "status": "pending",
        "attempts": 0,
        "error_message": None,
        "created_at": iso(now_utc()),
        "sent_at": None,
        "printed_at": None,
    }
    res = await db.print_jobs.insert_one(doc)
    return serialize(await db.print_jobs.find_one({"_id": res.inserted_id}))


# ----- Printers CRUD -----
@api.get("/printers")
async def list_printers(user: dict = Depends(get_current_user)):
    return await list_docs("printers", sort=[("name", 1)])


@api.post("/printers")
async def create_printer(req: PrinterReq, user: dict = Depends(require_roles("admin"))):
    doc = {**req.model_dump(), "status": "unknown", "last_seen_at": None, "created_at": iso(now_utc())}
    res = await db.printers.insert_one(doc)
    return serialize(await db.printers.find_one({"_id": res.inserted_id}))


@api.patch("/printers/{pid}")
async def update_printer(pid: str, req: PrinterReq, user: dict = Depends(require_roles("admin"))):
    await db.printers.update_one({"_id": parse_oid(pid)}, {"$set": req.model_dump()})
    return serialize(await db.printers.find_one({"_id": parse_oid(pid)}))


@api.delete("/printers/{pid}")
async def delete_printer(pid: str, user: dict = Depends(require_roles("admin"))):
    await db.printers.delete_one({"_id": parse_oid(pid)})
    return {"success": True}


# ----- Print agents -----
@api.get("/agents")
async def list_agents(user: dict = Depends(require_roles("admin"))):
    return await list_docs("print_agents", sort=[("created_at", -1)])


@api.post("/agents")
async def create_agent(req: AgentReq, user: dict = Depends(require_roles("admin"))):
    doc = {"name": req.name, "api_key": secrets.token_hex(24),
           "last_heartbeat_at": None, "created_at": iso(now_utc())}
    res = await db.print_agents.insert_one(doc)
    return serialize(await db.print_agents.find_one({"_id": res.inserted_id}))


@api.delete("/agents/{aid}")
async def delete_agent(aid: str, user: dict = Depends(require_roles("admin"))):
    await db.print_agents.delete_one({"_id": parse_oid(aid)})
    return {"success": True}


# ----- Print jobs (admin view) -----
@api.get("/print-jobs")
async def list_print_jobs(user: dict = Depends(require_roles("admin"))):
    docs = await db.print_jobs.find({}).sort("created_at", -1).to_list(200)
    return [serialize(d) for d in docs]


@api.post("/print-jobs/{jid}/retry")
async def retry_print_job(jid: str, user: dict = Depends(require_roles("admin"))):
    job = await db.print_jobs.find_one({"_id": parse_oid(jid)})
    if not job:
        raise HTTPException(status_code=404, detail="Задание не найдено")
    await db.print_jobs.update_one(
        {"_id": parse_oid(jid)},
        {"$set": {"status": "pending", "error_message": None, "sent_at": None, "printed_at": None}},
    )
    return serialize(await db.print_jobs.find_one({"_id": parse_oid(jid)}))


# ----- Order printing actions -----
@api.post("/orders/{oid}/request-bill")
async def request_bill(oid: str, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    printer = await db.printers.find_one({"station": "precheck", "active": True})
    if not printer:
        raise HTTPException(status_code=400, detail="Не настроен принтер пречека (станция precheck)")
    job = await make_job(o, printer, "precheck", o["items"], o.get("subtotal"))
    return {"success": True, "job": job}


@api.delete("/orders/{oid}/items/{idx}")
async def void_order_item(oid: str, idx: int, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    items = o["items"]
    if idx < 0 or idx >= len(items):
        raise HTTPException(status_code=404, detail="Позиция не найдена")
    removed = items.pop(idx)
    void_job = None
    if removed.get("print_status") == "printed" and removed.get("workshop_id"):
        printer = await db.printers.find_one({"workshop_id": removed.get("workshop_id"), "active": True})
        if printer:
            void_job = await make_job(o, printer, "void", [removed])
    if not items:
        # последняя позиция сторнирована — заказ пуст, отменяем его целиком
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
    o = await db.orders.find_one({"_id": parse_oid(oid)})
    if not o:
        raise HTTPException(status_code=404, detail="Заказ не найден")
    if o["status"] == "closed":
        raise HTTPException(status_code=400, detail="Заказ уже закрыт")
    await db.orders.update_one({"_id": o["_id"]}, {"$set": {"table_id": req.table_id}})
    return serialize(await db.orders.find_one({"_id": o["_id"]}))


@api.post("/orders/{oid}/split")
async def split_order(oid: str, req: SplitReq, user: dict = Depends(get_current_user)):
    o = await db.orders.find_one({"_id": parse_oid(oid)})
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
    return await list_docs("printers")


@api.get("/agent/print-jobs")
async def agent_fetch_jobs(agent: dict = Depends(get_agent)):
    jobs = await db.print_jobs.find({"status": "pending"}).sort("created_at", 1).to_list(50)
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
    await db.print_jobs.update_one({"_id": parse_oid(jid)}, {"$set": upd, "$inc": {"attempts": 1}})
    return {"success": True}


@api.post("/agent/heartbeat")
async def agent_heartbeat(req: HeartbeatReq, agent: dict = Depends(get_agent)):
    await db.print_agents.update_one({"_id": agent["_id"]}, {"$set": {"last_heartbeat_at": iso(now_utc())}})
    for pid, status in (req.printers or {}).items():
        if ObjectId.is_valid(pid):
            await db.printers.update_one(
                {"_id": ObjectId(pid)}, {"$set": {"status": status, "last_seen_at": iso(now_utc())}}
            )
    return {"success": True}


@api.post("/agent/emulate")
async def emulate_agent(user: dict = Depends(require_roles("admin"))):
    """Симуляция локального агента: печатает все ожидающие задания (для демо в облаке)."""
    jobs = await db.print_jobs.find({"status": {"$in": ["pending", "sent"]}}).sort("created_at", 1).to_list(100)
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
    await db.printers.update_many({}, {"$set": {"status": "online", "last_seen_at": iso(now_utc())}})
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
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@resto.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "name": "Администратор", "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin", "created_at": iso(now_utc()),
        })
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password)}})

    # demo staff
    if not await db.users.find_one({"pin": "1111"}):
        await db.users.insert_one({"name": "Официант Иван", "role": "waiter",
                                   "pin": "1111", "created_at": iso(now_utc())})
    if not await db.users.find_one({"pin": "2222"}):
        await db.users.insert_one({"name": "Кассир Мария", "role": "cashier",
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

    logger.info("Seed complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()
