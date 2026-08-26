"""Iteration 9 — Multi-tenancy foundation regression tests.

Covers: manager login + JWT restaurant scope, /restaurants/current, tenant-scoped
list endpoints (non-empty + restaurant_id stamped), PIN logins, full POS write
flow (shift -> order -> pay -> close), reports, role protection.
"""
import base64
import json

import pytest
import requests

from conftest import API

LIST_ENDPOINTS = [
    "products", "categories", "workshops", "tables",
    "inventory", "staff", "printers",
]


def _jwt_payload(token):
    part = token.split(".")[1]
    part += "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(part))


# --- Auth / JWT restaurant scope ---
class TestAuthScope:
    def test_manager_login_token_has_rid(self, test_credentials):
        r = requests.post(f"{API}/auth/login", json=test_credentials, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["user"]["role"] == "manager"
        p = _jwt_payload(body["token"])
        assert p.get("rid"), f"JWT missing restaurant scope: {p}"
        assert isinstance(p["rid"], str) and len(p["rid"]) == 24

    @pytest.mark.parametrize("pin,role", [("2222", "admin"), ("1111", "waiter")])
    def test_pin_login(self, pin, role):
        r = requests.post(f"{API}/auth/pin-login", json={"pin": pin}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["user"]["role"] == role
        assert _jwt_payload(body["token"]).get("rid")

    def test_me_returns_restaurant_id(self, admin):
        r = admin.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json().get("restaurant_id")

    def test_bad_pin_rejected(self):
        r = requests.post(f"{API}/auth/pin-login", json={"pin": "0000"}, timeout=30)
        assert r.status_code in (401, 429), r.text[:200]


# --- Restaurants endpoints ---
class TestRestaurants:
    def test_current_restaurant(self, admin):
        r = admin.get(f"{API}/restaurants/current", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d is not None, "current restaurant is null"
        assert d["name"] == "Мята Спортивная", d
        assert d.get("id")
        assert "_id" not in d

    def test_list_restaurants(self, admin):
        r = admin.get(f"{API}/restaurants", timeout=30)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) >= 1
        assert any(x["name"] == "Мята Спортивная" for x in docs)

    def test_current_matches_me(self, admin):
        rid = admin.get(f"{API}/auth/me", timeout=30).json()["restaurant_id"]
        cur = admin.get(f"{API}/restaurants/current", timeout=30).json()
        assert cur["id"] == rid


# --- Tenant-scoped list endpoints ---
class TestScopedLists:
    @pytest.mark.parametrize("ep", LIST_ENDPOINTS)
    def test_list_non_empty_and_stamped(self, admin, ep):
        r = admin.get(f"{API}/{ep}", timeout=30)
        assert r.status_code == 200, f"{ep}: {r.status_code} {r.text[:300]}"
        docs = r.json()
        assert isinstance(docs, list), f"{ep} not a list"
        assert len(docs) > 0, f"{ep} returned EMPTY list (possible bad tenant scoping)"
        rid = admin.get(f"{API}/auth/me", timeout=30).json()["restaurant_id"]
        for d in docs:
            assert "_id" not in d, f"{ep} leaks mongo _id"
            assert d.get("restaurant_id") == rid, f"{ep} doc missing/wrong restaurant_id: {d}"

    @pytest.mark.parametrize("ep", ["suppliers", "invoices", "writeoffs", "orders", "shifts", "agents", "print-jobs"])
    def test_other_lists_ok(self, admin, ep):
        r = admin.get(f"{API}/{ep}", timeout=30)
        assert r.status_code == 200, f"{ep}: {r.status_code} {r.text[:300]}"
        assert isinstance(r.json(), list)

    def test_tables_visible_to_waiter(self, waiter):
        r = waiter.get(f"{API}/tables", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert len(r.json()) > 0, "waiter sees no tables"


# --- Full POS write flow ---
class TestPosFlow:
    def _item(self, prod, count=1):
        return {"product_id": prod["id"], "name": prod["name"],
                "price": prod["price"], "count": count,
                "workshop_id": prod.get("workshop_id")}

    def test_full_flow(self, admin, cashier, waiter):
        rid = admin.get(f"{API}/auth/me", timeout=30).json()["restaurant_id"]

        # ensure shift open (admin PIN role opens shift)
        cur = cashier.get(f"{API}/shifts/current", timeout=30)
        assert cur.status_code == 200, cur.text[:300]
        op = cashier.post(f"{API}/shifts/open", timeout=30)
        assert op.status_code == 200, f"shift open failed: {op.status_code} {op.text[:300]}"
        assert op.json().get("restaurant_id") == rid, op.json()
        shift = cashier.get(f"{API}/shifts/current", timeout=30).json()
        assert shift and shift.get("restaurant_id") == rid

        tables = waiter.get(f"{API}/tables", timeout=30).json()
        products = waiter.get(f"{API}/products", timeout=30).json()
        assert products, "no products for waiter"
        table = tables[0]
        prod = products[0]

        # create order
        payload = {"table_id": table["id"], "items": [self._item(prod, 2)]}
        r = waiter.post(f"{API}/orders", json=payload, timeout=30)
        assert r.status_code == 200, f"create order failed: {r.status_code} {r.text[:400]}"
        order = r.json()
        oid = order["id"]
        assert order.get("restaurant_id") == rid, f"order missing restaurant_id: {order}"
        assert order["total"] == pytest.approx(prod["price"] * 2, abs=0.01)

        # GET back
        g = waiter.get(f"{API}/orders/{oid}", timeout=30)
        assert g.status_code == 200
        assert g.json()["restaurant_id"] == rid

        # order shows in scoped list
        lst = waiter.get(f"{API}/orders", timeout=30).json()
        assert any(o["id"] == oid for o in lst), "created order not in scoped list"

        # table now shows the open order
        tbls = waiter.get(f"{API}/tables", timeout=30).json()
        t = next(x for x in tbls if x["id"] == table["id"])
        assert oid in [o["id"] for o in t.get("open_orders", [])], t
        assert t.get("open_total", 0) > 0

        # update order (change qty)
        up = waiter.put(f"{API}/orders/{oid}", json={"items": [self._item(prod, 3)]}, timeout=30)
        assert up.status_code == 200, f"update failed: {up.status_code} {up.text[:400]}"
        upd = waiter.get(f"{API}/orders/{oid}", timeout=30).json()
        total = upd["total"]
        assert total == pytest.approx(prod["price"] * 3, abs=0.01), upd

        # send to kitchen
        snd = waiter.post(f"{API}/orders/{oid}/send", timeout=30)
        assert snd.status_code == 200, f"send failed: {snd.status_code} {snd.text[:400]}"

        # pay (admin PIN / cashier role)
        pay = cashier.post(f"{API}/orders/{oid}/pay",
                           json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert pay.status_code == 200, f"pay failed: {pay.status_code} {pay.text[:400]}"
        final = cashier.get(f"{API}/orders/{oid}", timeout=30).json()
        assert final["status"] == "closed", final.get("status")
        assert final["restaurant_id"] == rid
        assert final["payment_method"] == "cash"

        # table freed after payment
        tbls = waiter.get(f"{API}/tables", timeout=30).json()
        t = next(x for x in tbls if x["id"] == table["id"])
        assert oid not in [o["id"] for o in t.get("open_orders", [])], t

    def test_shift_close_works(self, cashier):
        # close then reopen so environment stays usable
        opens = cashier.get(f"{API}/orders?status=open", timeout=30)
        assert opens.status_code == 200
        if opens.json():
            pytest.skip("open orders present; skipping shift close test")
        cl = cashier.post(f"{API}/shifts/close", timeout=30)
        assert cl.status_code == 200, f"close failed: {cl.status_code} {cl.text[:300]}"
        assert cl.json().get("status") == "closed"
        re = cashier.post(f"{API}/shifts/open", timeout=30)
        assert re.status_code == 200


# --- Reports still scoped and working ---
class TestReports:
    @pytest.mark.parametrize("ep", [
        "dashboard", "sales", "by-category", "by-workshop", "abc",
        "analytics", "corrections",
    ])
    def test_report_ok(self, admin, ep):
        r = admin.get(f"{API}/reports/{ep}", timeout=60)
        assert r.status_code == 200, f"{ep}: {r.status_code} {r.text[:300]}"
        d = r.json()
        assert d is not None
        if isinstance(d, dict):
            assert len(d) > 0, f"{ep} empty dict"

    def test_dashboard_shape(self, admin):
        d = admin.get(f"{API}/reports/dashboard", timeout=60).json()
        assert isinstance(d, dict) and len(d) > 0


# --- Role protection ---
class TestRoleProtection:
    @pytest.mark.parametrize("sess", ["waiter", "cashier"])
    def test_products_post_forbidden(self, request, sess):
        s = request.getfixturevalue(sess)
        r = s.post(f"{API}/products", json={"name": "TEST_x", "price": 1}, timeout=30)
        assert r.status_code == 403, f"{sess} got {r.status_code}"

    @pytest.mark.parametrize("sess", ["waiter", "cashier"])
    def test_reports_sales_forbidden(self, request, sess):
        s = request.getfixturevalue(sess)
        r = s.get(f"{API}/reports/sales", timeout=30)
        assert r.status_code == 403, f"{sess} got {r.status_code}"

    def test_no_auth_unauthorized(self):
        r = requests.get(f"{API}/products", timeout=30)
        assert r.status_code in (401, 403)

    def test_bad_token_unauthorized(self):
        r = requests.get(f"{API}/products", headers={"Authorization": "Bearer bogus"}, timeout=30)
        assert r.status_code == 401
