# Modules: Workshops, Categories, Products, Tables, Staff (admin CRUD)
import requests
from conftest import API


class TestWorkshops:
    def test_crud(self, admin):
        r = admin.post(f"{API}/workshops", json={"name": "TEST_Cex", "color": "#123456"}, timeout=30)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w["name"] == "TEST_Cex" and w["color"] == "#123456"
        assert "_id" not in w and "id" in w
        wid = w["id"]

        lst = admin.get(f"{API}/workshops", timeout=30).json()
        assert any(x["id"] == wid for x in lst)

        upd = admin.put(f"{API}/workshops/{wid}", json={"name": "TEST_Cex2", "color": "#654321"}, timeout=30)
        assert upd.status_code == 200 and upd.json()["name"] == "TEST_Cex2"

        assert admin.delete(f"{API}/workshops/{wid}", timeout=30).status_code == 200
        assert not any(x["id"] == wid for x in admin.get(f"{API}/workshops", timeout=30).json())

    def test_seed_workshops_present(self, admin):
        names = [w["name"] for w in admin.get(f"{API}/workshops", timeout=30).json()]
        assert "Кухня" in names and "Бар" in names


class TestCategories:
    def test_crud(self, admin):
        r = admin.post(f"{API}/categories", json={"name": "TEST_Cat", "color": "#111111", "position": 9}, timeout=30)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        assert r.json()["position"] == 9
        assert any(c["id"] == cid for c in admin.get(f"{API}/categories", timeout=30).json())
        assert admin.delete(f"{API}/categories/{cid}", timeout=30).status_code == 200
        assert not any(c["id"] == cid for c in admin.get(f"{API}/categories", timeout=30).json())


class TestProducts:
    def test_crud_and_persistence(self, admin):
        cats = admin.get(f"{API}/categories", timeout=30).json()
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        payload = {"name": "TEST_Product", "category_id": cats[0]["id"],
                   "workshop_id": ws[0]["id"], "price": 25.5, "cost": 10.0,
                   "measure": "pcs", "for_sale": True}
        r = admin.post(f"{API}/products", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        pid = p["id"]
        assert p["price"] == 25.5 and p["workshop_id"] == ws[0]["id"]

        fetched = [x for x in admin.get(f"{API}/products", timeout=30).json() if x["id"] == pid]
        assert fetched and fetched[0]["name"] == "TEST_Product"

        payload["price"] = 30.0
        payload["name"] = "TEST_Product2"
        u = admin.put(f"{API}/products/{pid}", json=payload, timeout=30)
        assert u.status_code == 200 and u.json()["price"] == 30.0
        again = [x for x in admin.get(f"{API}/products", timeout=30).json() if x["id"] == pid][0]
        assert again["price"] == 30.0 and again["name"] == "TEST_Product2"

        assert admin.delete(f"{API}/products/{pid}", timeout=30).status_code == 200
        assert not any(x["id"] == pid for x in admin.get(f"{API}/products", timeout=30).json())

    def test_seed_products(self, admin):
        prods = admin.get(f"{API}/products", timeout=30).json()
        assert len(prods) >= 8
        for p in prods:
            assert "_id" not in p


class TestTables:
    def test_crud(self, admin):
        r = admin.post(f"{API}/tables", json={"name": "TEST_Table", "hall": "Терраса", "seats": 6}, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        assert r.json()["seats"] == 6
        got = [t for t in admin.get(f"{API}/tables", timeout=30).json() if t["id"] == tid]
        assert got and "open_order" in got[0]
        assert admin.delete(f"{API}/tables/{tid}", timeout=30).status_code == 200
        assert not any(t["id"] == tid for t in admin.get(f"{API}/tables", timeout=30).json())


class TestStaff:
    def test_create_waiter_and_delete(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Waiter", "role": "waiter", "pin": "9182"}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["role"] == "waiter" and u["pin"] == "9182"
        assert "password_hash" not in u
        sid = u["id"]

        lr = requests.post(f"{API}/auth/pin-login", json={"pin": "9182"}, timeout=30)
        assert lr.status_code == 200

        assert any(s["id"] == sid for s in admin.get(f"{API}/staff", timeout=30).json())
        assert admin.delete(f"{API}/staff/{sid}", timeout=30).status_code == 200
        assert not any(s["id"] == sid for s in admin.get(f"{API}/staff", timeout=30).json())

    def test_duplicate_pin_rejected(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Dup", "role": "cashier", "pin": "2222"}, timeout=30)
        assert r.status_code == 400

    def test_waiter_without_pin_rejected(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_NoPin", "role": "waiter"}, timeout=30)
        assert r.status_code == 400

    def test_cannot_delete_self(self, admin):
        me = admin.get(f"{API}/auth/me", timeout=30).json()
        assert admin.delete(f"{API}/staff/{me['id']}", timeout=30).status_code == 400
