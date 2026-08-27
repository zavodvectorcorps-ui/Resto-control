# Cleanup of iteration-13 test artifacts (refunds/corrections/test orders/reservations/stop-list)
import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    refunds = await db.refunds.find({}).to_list(1000)
    test_refunds = [r for r in refunds if (r.get("reason") or "").startswith("TEST_") or (r.get("reason") or "") == ""]
    order_ids = {r["order_id"] for r in test_refunds}
    print("test refunds:", len(test_refunds), "orders:", order_ids)

    for r in test_refunds:
        await db.refunds.delete_one({"_id": r["_id"]})
    cr = await db.order_corrections.delete_many({"reason": {"$regex": "^Возврат: TEST"}})
    print("corrections deleted:", cr.deleted_count)
    cr2 = await db.order_corrections.delete_many({"reason": "Возврат: "})
    print("corrections (empty reason) deleted:", cr2.deleted_count)

    # remove orders that only existed for the refund tests
    for oid in order_ids:
        from bson import ObjectId
        res = await db.orders.delete_one({"_id": ObjectId(oid)})
        print("order deleted", oid, res.deleted_count)

    rv = await db.reservations.delete_many({"guest_name": {"$regex": "^TEST_"}})
    print("test reservations deleted:", rv.deleted_count)

    sl = await db.stop_list.delete_many({})
    print("stop list cleared:", sl.deleted_count)

    await db.settings.update_one({"key": "venue"},
                                 {"$set": {"service_charge_percent": 10,
                                           "service_charge_default_enabled": False}})
    s = await db.settings.find_one({"key": "venue"})
    print("service charge:", s.get("service_charge_percent"), s.get("service_charge_default_enabled"))
    print("remaining refunds:", await db.refunds.count_documents({}))
    print("remaining reservations:", await db.reservations.count_documents({}))
    client.close()


asyncio.run(main())
