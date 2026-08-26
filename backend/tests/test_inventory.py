# Module: Inventory / Warehouse (items, invoices increase balance, writeoffs decrease)
import uuid

from conftest import API


class TestInventory:
    def test_item_crud(self, admin):
        r = admin.post(f"{API}/inventory", json={"name": "TEST_Flour", "measure": "kg",
                                                 "balance": 5, "cost": 1.5}, timeout=30)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["balance"] == 5 and item["measure"] == "kg"
        iid = item["id"]
        got = [i for i in admin.get(f"{API}/inventory", timeout=30).json() if i["id"] == iid]
        assert got and got[0]["cost"] == 1.5
        assert admin.delete(f"{API}/inventory/{iid}", timeout=30).status_code == 200
        assert not any(i["id"] == iid for i in admin.get(f"{API}/inventory", timeout=30).json())

    def test_invoice_increases_balance(self, admin):
        c = admin.post(f"{API}/inventory", json={"name": "TEST_Salt", "measure": "kg",
                                                 "balance": 10, "cost": 1.0}, timeout=30)
        iid = c.json()["id"]
        num = f"TEST-{uuid.uuid4().hex[:6]}"
        inv = admin.post(f"{API}/invoices", json={
            "number": num, "supplier_name": "TEST_Supplier",
            "items": [{"inventory_id": iid, "name": "TEST_Salt", "amount": 7, "price": 2.0}]}, timeout=30)
        assert inv.status_code == 200, inv.text
        assert inv.json()["total"] == 14.0
        after = [i for i in admin.get(f"{API}/inventory", timeout=30).json() if i["id"] == iid][0]
        assert after["balance"] == 17, f"expected 17 got {after['balance']}"
        assert after["cost"] == 2.0

        dup = admin.post(f"{API}/invoices", json={"number": num, "items": []}, timeout=30)
        assert dup.status_code == 400

        assert any(x["number"] == num for x in admin.get(f"{API}/invoices", timeout=30).json())
        admin.delete(f"{API}/inventory/{iid}", timeout=30)

    def test_writeoff_decreases_balance(self, admin):
        c = admin.post(f"{API}/inventory", json={"name": "TEST_Pepper", "measure": "kg",
                                                 "balance": 8, "cost": 3.0}, timeout=30)
        iid = c.json()["id"]
        w = admin.post(f"{API}/writeoffs", json={"inventory_id": iid, "amount": 3,
                                                 "reason": "TEST_spoil"}, timeout=30)
        assert w.status_code == 200, w.text
        assert w.json()["amount"] == 3 and w.json()["name"] == "TEST_Pepper"
        after = [i for i in admin.get(f"{API}/inventory", timeout=30).json() if i["id"] == iid][0]
        assert after["balance"] == 5, f"expected 5 got {after['balance']}"
        admin.delete(f"{API}/inventory/{iid}", timeout=30)

    def test_writeoff_more_than_balance_rejected(self, admin):
        c = admin.post(f"{API}/inventory", json={"name": "TEST_Over", "measure": "kg",
                                                 "balance": 2, "cost": 1.0}, timeout=30)
        iid = c.json()["id"]
        w = admin.post(f"{API}/writeoffs", json={"inventory_id": iid, "amount": 100,
                                                 "reason": "TEST"}, timeout=30)
        bal = [i for i in admin.get(f"{API}/inventory", timeout=30).json() if i["id"] == iid][0]["balance"]
        admin.delete(f"{API}/inventory/{iid}", timeout=30)
        assert w.status_code == 400, f"negative stock allowed: status {w.status_code}, balance now {bal}"

    def test_writeoff_unknown_item_404(self, admin):
        r = admin.post(f"{API}/writeoffs", json={"inventory_id": "64b7f9a2c1a2b3c4d5e6f7a8",
                                                 "amount": 1}, timeout=30)
        assert r.status_code == 404


class TestSuppliers:
    def test_crud(self, admin):
        r = admin.post(f"{API}/suppliers", json={"name": "TEST_Supplier", "phone": "+100"}, timeout=30)
        assert r.status_code == 200
        sid = r.json()["id"]
        assert any(s["id"] == sid for s in admin.get(f"{API}/suppliers", timeout=30).json())
        assert admin.delete(f"{API}/suppliers/{sid}", timeout=30).status_code == 200
