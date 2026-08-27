# Remove closed orders created during iteration-13 testing window (last N minutes)
import asyncio
import datetime
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")
MINUTES = int(sys.argv[1]) if len(sys.argv) > 1 else 40


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]
    cutoff = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=MINUTES)).isoformat()
    docs = await db.orders.find({}).to_list(5000)
    victims = [d for d in docs if (d.get("created_at") or "") >= cutoff]
    for d in victims:
        print("deleting order", str(d["_id"]), d.get("status"), d.get("total"), d.get("created_at"))
        await db.orders.delete_one({"_id": d["_id"]})
    print("deleted:", len(victims), "| remaining orders:", await db.orders.count_documents({}))
    client.close()


asyncio.run(main())
