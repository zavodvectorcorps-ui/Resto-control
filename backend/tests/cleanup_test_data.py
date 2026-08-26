"""Cleanup helper: removes leftover open/sent orders created during UI testing."""
import asyncio
import os

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = c[os.environ["DB_NAME"]]
    stale = await d.orders.find({"status": {"$in": ["open", "sent"]}}).to_list(1000)
    print("stale open/sent orders:", len(stale))
    for o in stale:
        print("  table", o.get("table_id"), "total", o.get("total"), "status", o["status"])
    res = await d.orders.delete_many({"status": {"$in": ["open", "sent"]}})
    print("deleted:", res.deleted_count)
    # remove TEST_ artifacts
    for coll in ["products", "categories", "workshops", "tables", "inventory",
                 "suppliers", "invoices", "writeoffs"]:
        r = await d[coll].delete_many({"name": {"$regex": "^TEST_"}})
        if r.deleted_count:
            print(f"cleaned {coll}: {r.deleted_count}")
    r = await d.users.delete_many({"name": {"$regex": "^TEST_"}})
    print("cleaned users:", r.deleted_count)
    c.close()


asyncio.run(main())
