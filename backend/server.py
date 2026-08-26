from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, BeforeValidator, ConfigDict
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, timedelta, date
from bson import ObjectId
import logging
import time
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


class ProductReq(BaseModel):
    name: str
    category_id: Optional[str] = None
    workshop_id: Optional[str] = None
    price: float = 0.0
    cost: float = 0.0
    measure: str = "pcs"
    image: Optional[str] = None
    for_sale: bool = True


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


# ---------------------------------------------------------------------------
# AUTH ROUTES
# ---------------------------------------------------------------------------
@api.post("/auth/login")
async def login(req: LoginReq, request: Request):
    ip = request.client.host if request.client else "?"
    email = req.email.strip().lower()
    key = f"login:{ip}:{email}"
    check_lock(key)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        record_fail(key)
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    clear_fails(key)
    token = create_token(str(user["_id"]), user["role"])
    u = serialize(user)
    u.pop("password_hash", None)
    return {"token": token, "user": u}


@api.post("/auth/pin-login")
async def pin_login(req: PinLoginReq, request: Request):
    ip = request.client.host if request.client else "?"
    key = f"pin:{ip}"
    check_lock(key)
    user = await db.users.find_one({"pin": req.pin.strip()})
    if not user:
        record_fail(key)
        raise HTTPException(status_code=401, detail="Неверный PIN-код")
    clear_fails(key)
    token = create_token(str(user["_id"]), user["role"])
    u = serialize(user)
    u.pop("password_hash", None)
    return {"token": token, "user": u}


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
    # attach open order info
    open_orders = await db.orders.find({"status": {"$in": ["open", "sent"]}}).to_list(2000)
    by_table = {}
    for o in open_orders:
        if o.get("table_id"):
            by_table[o["table_id"]] = serialize(o)
    for t in tables:
        t["open_order"] = by_table.get(t["id"])
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
async def open_shift(user: dict = Depends(get_current_user)):
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
    await db.orders.update_one(
        {"_id": parse_oid(oid)}, {"$set": {"status": "sent", "sent_at": iso(now_utc())}}
    )
    # build kitchen tickets grouped by workshop
    workshops = {w["id"]: w for w in await list_docs("workshops")}
    tickets = {}
    for it in o["items"]:
        wid = it.get("workshop_id") or "none"
        wname = workshops.get(wid, {}).get("name", "Без цеха")
        tickets.setdefault(wname, []).append({"name": it["name"], "count": it["count"]})
    return {"success": True, "tickets": tickets}


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
    return serialize(await db.orders.find_one({"_id": parse_oid(oid)}))


@api.delete("/orders/{oid}")
async def delete_order(oid: str, user: dict = Depends(get_current_user)):
    await db.orders.delete_one({"_id": parse_oid(oid), "status": {"$ne": "closed"}})
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
# App wiring
# ---------------------------------------------------------------------------
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
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

        for name, m, bal, cost in [("Говядина", "kg", 20, 8.0), ("Булочки", "pcs", 100, 0.3),
                                    ("Сыр", "kg", 10, 6.0), ("Кофе зерно", "kg", 5, 15.0)]:
            await db.inventory.insert_one({"name": name, "measure": m, "balance": bal,
                                           "cost": cost, "created_at": iso(now_utc())})

    logger.info("Seed complete")


@app.on_event("shutdown")
async def shutdown():
    client.close()
