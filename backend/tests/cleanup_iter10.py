"""Iteration 10 cleanup: remove TEST_ warehouses/inventory/products/invoices/writeoffs,
move any stock left on TEST warehouses back to the default one and resync inventory.balance."""
import asyncio
import os

from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from bson import ObjectId  # noqa: E402


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    d = c[os.environ["DB_NAME"]]

    # 1. TEST warehouses -> move leftover stock to the default warehouse, then drop
    test_whs = await d.warehouses.find({"name": {"$regex": "^TEST"}}).to_list(100)
    for wh in test_whs:
        rid = wh["restaurant_id"]
        default = await d.warehouses.find_one({"restaurant_id": rid, "is_default": True})
        whid = str(wh["_id"])
        for s in await d.stock.find({"warehouse_id": whid}).to_list(1000):
            q = s.get("quantity", 0)
            if q:
                await d.stock.update_one(
                    {"restaurant_id": rid, "inventory_id": s["inventory_id"],
                     "warehouse_id": str(default["_id"])},
                    {"$inc": {"quantity": q}}, upsert=True)
            await d.stock.delete_one({"_id": s["_id"]})
        await d.warehouses.delete_one({"_id": wh["_id"]})
        print("removed TEST warehouse:", wh["name"])

    # 2. TEST docs
    for coll in ["products", "inventory", "writeoffs", "suppliers"]:
        r = await d[coll].delete_many({"name": {"$regex": "^TEST"}})
        print(f"cleaned {coll}: {r.deleted_count}")
    r = await d.invoices.delete_many({"number": {"$regex": "^TEST"}})
    print("cleaned invoices:", r.deleted_count)
    r = await d.writeoffs.delete_many({"reason": {"$regex": "^TEST"}})
    print("cleaned writeoff reasons:", r.deleted_count)

    # 3. orphan stock rows (inventory item gone)
    inv_ids = {str(i["_id"]) for i in await d.inventory.find({}, {"_id": 1}).to_list(5000)}
    wh_ids = {str(w["_id"]) for w in await d.warehouses.find({}, {"_id": 1}).to_list(500)}
    orphans = [s for s in await d.stock.find({}).to_list(20000)
               if s["inventory_id"] not in inv_ids or s["warehouse_id"] not in wh_ids]
    for s in orphans:
        await d.stock.delete_one({"_id": s["_id"]})
    print("removed orphan stock rows:", len(orphans))

    # 4. resync inventory.balance = sum(stocks) (fixes the delete-warehouse desync)
    fixed = 0
    for item in await d.inventory.find({}).to_list(5000):
        iid = str(item["_id"])
        rows = await d.stock.find({"inventory_id": iid}).to_list(500)
        total = round(sum(r.get("quantity", 0) for r in rows), 4)
        if abs(total - item.get("balance", 0)) > 1e-6:
            await d.inventory.update_one({"_id": item["_id"]}, {"$set": {"balance": total}})
            print(f"  resync {item['name']}: {item.get('balance')} -> {total}")
            fixed += 1
    print("balances resynced:", fixed)

    # 5. leftover open/sent orders from UI testing
    r = await d.orders.delete_many({"status": {"$in": ["open", "sent"]}})
    print("deleted stale open/sent orders:", r.deleted_count)
    c.close()


asyncio.run(main())
