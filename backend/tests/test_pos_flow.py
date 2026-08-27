# Module: Shifts + Orders end-to-end POS flow + Reports
from conftest import API


class TestPosFlow:
    def test_full_order_lifecycle_and_reports(self, admin, cashier):
        cur = cashier.get(f"{API}/shifts/current", timeout=30)
        assert cur.status_code == 200
        if cur.json():
            cashier.post(f"{API}/shifts/close", timeout=30)
        assert cashier.get(f"{API}/shifts/current", timeout=30).json() is None

        prods = cashier.get(f"{API}/products", timeout=30).json()
        p1 = prods[0]
        no_shift = cashier.post(f"{API}/orders", json={"items": [
            {"product_id": p1["id"], "name": p1["name"], "price": p1["price"], "count": 1}]}, timeout=30)
        assert no_shift.status_code == 400, "order created without open shift"

        sh = cashier.post(f"{API}/shifts/open", timeout=30)
        assert sh.status_code == 200, sh.text
        assert sh.json()["status"] == "open"
        shift_id = sh.json()["id"]
        assert cashier.post(f"{API}/shifts/open", timeout=30).json()["id"] == shift_id

        tables = cashier.get(f"{API}/tables", timeout=30).json()
        tid = tables[0]["id"]
        kitchen_p = next(p for p in prods if p.get("workshop_id"))
        other_p = next((p for p in prods if p.get("workshop_id")
                        and p["workshop_id"] != kitchen_p["workshop_id"]), prods[1])
        items = [
            {"product_id": kitchen_p["id"], "name": kitchen_p["name"], "price": kitchen_p["price"],
             "count": 2, "workshop_id": kitchen_p.get("workshop_id")},
            {"product_id": other_p["id"], "name": other_p["name"], "price": other_p["price"],
             "count": 1, "workshop_id": other_p.get("workshop_id")},
        ]
        expected = round(kitchen_p["price"] * 2 + other_p["price"], 2)
        o = cashier.post(f"{API}/orders", json={"table_id": tid, "items": items}, timeout=30)
        assert o.status_code == 200, o.text
        order = o.json()
        oid = order["id"]
        assert order["subtotal"] == expected and order["total"] == expected
        assert order["status"] == "open" and order["shift_id"] == shift_id
        assert order["items"][0]["total"] == round(kitchen_p["price"] * 2, 2)

        t = [x for x in cashier.get(f"{API}/tables", timeout=30).json() if x["id"] == tid][0]
        assert t["open_order"] and t["open_order"]["id"] == oid

        items.append({"product_id": other_p["id"], "name": other_p["name"],
                      "price": other_p["price"], "count": 1,
                      "workshop_id": other_p.get("workshop_id")})
        expected2 = round(expected + other_p["price"], 2)
        u = cashier.put(f"{API}/orders/{oid}", json={"items": items}, timeout=30)
        assert u.status_code == 200 and u.json()["total"] == expected2
        assert cashier.get(f"{API}/orders/{oid}", timeout=30).json()["total"] == expected2

        s = cashier.post(f"{API}/orders/{oid}/send", timeout=30)
        assert s.status_code == 200, s.text
        body = s.json()
        assert body["success"] is True
        tickets = body["tickets"]
        assert isinstance(tickets, list) and len(tickets) >= 1
        names = {t["workshop"] for t in tickets}
        assert "Без цеха" not in names, f"workshop name unresolved: {tickets}"
        assert cashier.get(f"{API}/orders/{oid}", timeout=30).json()["status"] == "sent"

        before = admin.get(f"{API}/reports/dashboard", timeout=30).json()
        pay = cashier.post(f"{API}/orders/{oid}/pay",
                           json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert pay.status_code == 200, pay.text
        paid = pay.json()
        assert paid["status"] == "closed" and paid["payment_method"] == "cash"
        assert paid["total"] == expected2
        assert paid["cashier_name"]

        assert cashier.post(f"{API}/orders/{oid}/pay",
                            json={"payment_method": "cash"}, timeout=30).status_code == 400

        t = [x for x in cashier.get(f"{API}/tables", timeout=30).json() if x["id"] == tid][0]
        assert t["open_order"] is None

        after = admin.get(f"{API}/reports/dashboard", timeout=30).json()
        assert round(after["revenue_today"] - before["revenue_today"], 2) == expected2
        assert after["orders_today"] == before["orders_today"] + 1
        assert len(after["revenue_7days"]) == 7
        assert after["avg_check"] > 0
        assert any(tp["name"] == kitchen_p["name"] for tp in after["top_products"])

        rep = admin.get(f"{API}/reports/sales", timeout=30)
        assert rep.status_code == 200
        rd = rep.json()
        assert rd["total"] >= expected2 and rd["cash"] >= expected2
        assert any(p["name"] == kitchen_p["name"] for p in rd["by_product"])
        assert rd["by_cashier"]

        cl = cashier.post(f"{API}/shifts/close", timeout=30)
        assert cl.status_code == 200, cl.text
        cd = cl.json()
        assert cd["status"] == "closed"
        assert cd["orders_count"] >= 1
        assert cd["total_sales"] >= expected2
        assert cd["total_cash"] >= expected2
        assert cashier.get(f"{API}/shifts/current", timeout=30).json() is None
        assert cashier.post(f"{API}/shifts/close", timeout=30).status_code == 400

    def test_discount_applied_on_pay(self, cashier):
        cashier.post(f"{API}/shifts/open", timeout=30)
        prods = cashier.get(f"{API}/products", timeout=30).json()
        p = prods[0]
        o = cashier.post(f"{API}/orders", json={"items": [
            {"product_id": p["id"], "name": p["name"], "price": p["price"], "count": 2,
             "workshop_id": p.get("workshop_id")}]}, timeout=30).json()
        sub = o["subtotal"]
        pay = cashier.post(f"{API}/orders/{o['id']}/pay",
                           json={"payment_method": "card", "discount": 1.0}, timeout=30)
        assert pay.status_code == 200
        assert pay.json()["total"] == round(sub - 1.0, 2)
        assert pay.json()["payment_method"] == "card"
        cashier.post(f"{API}/shifts/close", timeout=30)

    def test_order_not_found(self, cashier):
        r = cashier.get(f"{API}/orders/64b7f9a2c1a2b3c4d5e6f7a8", timeout=30)
        assert r.status_code == 404

    def test_orders_filter_by_status(self, admin):
        r = admin.get(f"{API}/orders", params={"status": "closed"}, timeout=30)
        assert r.status_code == 200
        for o in r.json():
            assert o["status"] == "closed"
            assert "_id" not in o
