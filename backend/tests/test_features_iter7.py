"""Task 0 (role rename/split manager|admin|waiter) + Task 1 (protected void of sent items)."""
import pytest
import requests

from conftest import API


# ---------- Task 0: roles ----------
class TestRoles:
    def test_manager_login_role(self, test_credentials):
        r = requests.post(f"{API}/auth/login", json=test_credentials, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["role"] == "manager", f"expected manager, got {u['role']}"
        assert "_id" not in u

    def test_pin_2222_is_admin(self):
        r = requests.post(f"{API}/auth/pin-login", json={"pin": "2222"}, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert u["role"] == "admin", u
        assert "Мария" in u["name"], u["name"]

    def test_pin_1111_is_waiter(self):
        r = requests.post(f"{API}/auth/pin-login", json={"pin": "1111"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "waiter"

    def test_no_legacy_cashier_role(self, admin):
        r = admin.get(f"{API}/staff", timeout=30)
        assert r.status_code == 200
        roles = {s["role"] for s in r.json()}
        assert roles <= {"manager", "admin", "waiter"}, roles

    def test_manager_blocked_from_pos_endpoints(self, admin):
        assert admin.post(f"{API}/shifts/open", timeout=30).status_code == 403

    def test_cashier_blocked_from_backoffice(self, cashier):
        assert cashier.get(f"{API}/staff", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/corrections", timeout=30).status_code == 403

    def test_waiter_blocked_from_shift_open(self, waiter):
        assert waiter.post(f"{API}/shifts/open", timeout=30).status_code == 403


# ---------- Task 0: create_staff role/credential rules ----------
class TestCreateStaff:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, admin):
        yield
        for sid in TestCreateStaff.created:
            admin.delete(f"{API}/staff/{sid}", timeout=30)

    def test_create_manager_requires_email_password(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Mgr", "role": "manager"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_create_manager_ok(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Mgr2", "role": "manager",
                                             "email": "test_mgr2@resto.com", "password": "pass1234"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        TestCreateStaff.created.append(d["id"])
        assert d["role"] == "manager" and d["email"] == "test_mgr2@resto.com"
        assert "password_hash" not in d and "_id" not in d
        lr = requests.post(f"{API}/auth/login", json={"email": "test_mgr2@resto.com", "password": "pass1234"}, timeout=30)
        assert lr.status_code == 200 and lr.json()["user"]["role"] == "manager"

    def test_create_pin_admin_ok(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Cashier", "role": "admin", "pin": "9911"}, timeout=30)
        assert r.status_code == 200, r.text
        TestCreateStaff.created.append(r.json()["id"])
        pr = requests.post(f"{API}/auth/pin-login", json={"pin": "9911"}, timeout=30)
        assert pr.status_code == 200 and pr.json()["user"]["role"] == "admin"

    def test_create_pin_role_requires_pin(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_NoPin", "role": "waiter"}, timeout=30)
        assert r.status_code == 400, r.text


# ---------- Task 1: protected delete of sent item ----------
def _item(p):
    return {"product_id": p["id"], "name": p["name"], "price": p["price"],
            "count": 1, "workshop_id": p.get("workshop_id")}


def _ensure_shift(cashier):
    s = cashier.get(f"{API}/shifts/current", timeout=30).json()
    if not s:
        r = cashier.post(f"{API}/shifts/open", timeout=30)
        assert r.status_code == 200, r.text


def _make_sent_order(sess, cashier):
    _ensure_shift(cashier)
    tables = sess.get(f"{API}/tables", timeout=30).json()
    prods = sess.get(f"{API}/products", timeout=30).json()
    p = prods[0]
    r = sess.post(f"{API}/orders", json={"table_id": tables[0]["id"],
                                         "items": [_item(p)]}, timeout=30)
    assert r.status_code == 200, r.text
    oid = r.json()["id"]
    k = sess.post(f"{API}/orders/{oid}/send", timeout=30)
    assert k.status_code == 200, k.text
    o = sess.get(f"{API}/orders/{oid}", timeout=30).json()
    assert o["items"][0]["print_status"] == "printed"
    return oid, p["name"]


class TestProtectedVoid:
    def test_pending_item_delete_instant(self, waiter, cashier):
        _ensure_shift(cashier)
        tables = waiter.get(f"{API}/tables", timeout=30).json()
        prods = waiter.get(f"{API}/products", timeout=30).json()
        r = waiter.post(f"{API}/orders", json={"table_id": tables[0]["id"],
                                              "items": [_item(prods[0]), _item(prods[1])]}, timeout=30)
        oid = r.json()["id"]
        d = waiter.delete(f"{API}/orders/{oid}/items/0", timeout=30)
        assert d.status_code == 200, d.text
        assert len(d.json()["order"]["items"]) == 1
        waiter.delete(f"{API}/orders/{oid}", timeout=30)

    def test_sent_item_requires_reason(self, waiter, cashier):
        oid, _ = _make_sent_order(waiter, cashier)
        d = waiter.request("DELETE", f"{API}/orders/{oid}/items/0", json={}, timeout=30)
        assert d.status_code == 400, d.text
        assert "причин" in d.json()["detail"].lower()
        # item still there
        o = waiter.get(f"{API}/orders/{oid}", timeout=30).json()
        assert len(o["items"]) == 1
        self._cleanup_order(waiter, cashier, oid)

    def test_sent_item_wrong_pin_403(self, waiter, cashier):
        oid, _ = _make_sent_order(waiter, cashier)
        d = waiter.request("DELETE", f"{API}/orders/{oid}/items/0",
                           json={"reason": "TEST_причина", "confirm_pin": "0000"}, timeout=30)
        assert d.status_code == 403, d.text
        # waiter pin is not enough
        d2 = waiter.request("DELETE", f"{API}/orders/{oid}/items/0",
                            json={"reason": "TEST_причина", "confirm_pin": "1111"}, timeout=30)
        assert d2.status_code == 403, d2.text
        self._cleanup_order(waiter, cashier, oid)

    def test_waiter_void_with_admin_pin_logs_correction(self, waiter, cashier, admin):
        oid, pname = _make_sent_order(waiter, cashier)
        d = waiter.request("DELETE", f"{API}/orders/{oid}/items/0",
                           json={"reason": "TEST_гость отказался", "confirm_pin": "2222"}, timeout=30)
        assert d.status_code == 200, d.text
        assert d.json()["deleted"] is True  # last item -> order removed
        recs = admin.get(f"{API}/reports/corrections", timeout=30).json()
        match = [c for c in recs if c["order_id"] == oid]
        assert match, "correction not logged"
        c = match[0]
        assert c["item_name"] == pname
        assert c["reason"] == "TEST_гость отказался"
        assert "Мария" in c["staff_name"], c["staff_name"]
        assert "_id" not in c

    def test_admin_void_needs_no_pin(self, cashier, admin):
        oid, pname = _make_sent_order(cashier, cashier)
        d = cashier.request("DELETE", f"{API}/orders/{oid}/items/0",
                            json={"reason": "TEST_админ сам"}, timeout=30)
        assert d.status_code == 200, d.text
        recs = admin.get(f"{API}/reports/corrections", timeout=30).json()
        match = [c for c in recs if c["order_id"] == oid]
        assert match and "Мария" in match[0]["staff_name"]

    def _cleanup_order(self, sess, cashier, oid):
        r = cashier.post(f"{API}/orders/{oid}/pay", json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert r.status_code == 200, f"cleanup pay failed: {r.text}"


# ---------- Known gaps found in iteration 7 ----------
class TestStaffRoleValidationGaps:
    @pytest.mark.xfail(reason="KNOWN GAP: `role` is not validated against an enum -> POST /staff "
                              "accepts arbitrary roles (e.g. 'superuser') and skips both the PIN and "
                              "the email/password requirement, creating an unusable ghost user",
                       strict=False)
    def test_arbitrary_role_rejected(self, admin):
        r = admin.post(f"{API}/staff", json={"name": "TEST_Bogus", "role": "superuser"}, timeout=30)
        if r.status_code == 200:
            admin.delete(f"{API}/staff/{r.json()['id']}", timeout=30)
        assert r.status_code == 400, r.text

    @pytest.mark.xfail(reason="KNOWN GAP: PUT /staff can promote a PIN-only user to role=manager "
                              "without email/password -> back-office is then reachable with a 4-digit PIN",
                       strict=False)
    def test_put_cannot_make_pin_manager(self, admin):
        c = admin.post(f"{API}/staff", json={"name": "TEST_Esc", "role": "waiter", "pin": "9733"}, timeout=30)
        sid = c.json()["id"]
        try:
            r = admin.put(f"{API}/staff/{sid}", json={"name": "TEST_Esc", "role": "manager", "pin": "9733"}, timeout=30)
            assert r.status_code == 400, (
                "manager without email/password accepted; pin-login role="
                + str(requests.post(f"{API}/auth/pin-login", json={"pin": "9733"}, timeout=30).json()
                      .get("user", {}).get("role"))
            )
        finally:
            admin.delete(f"{API}/staff/{sid}", timeout=30)
