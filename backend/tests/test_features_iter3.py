"""Iteration-3 backend tests: ESC/POS escape_t_value + codepage_label, void-last-item
auto-cancel, split by cart-line index, multi-open-orders per table, lockout never
rejects valid credentials, shifts/open RBAC, shift-close guard scoped to shift."""
import base64
import time

import pytest
import requests

from conftest import API


# ---------- helpers ----------
def ensure_shift(sess):
    r = sess.get(f"{API}/shifts/current", timeout=30)
    if r.status_code == 200 and r.json():
        return r.json()
    r = sess.post(f"{API}/shifts/open", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def first_product(sess):
    r = sess.get(f"{API}/products", timeout=30)
    assert r.status_code == 200
    prods = [p for p in r.json() if p.get("active", True)]
    assert prods, "no products seeded"
    return prods[0]


def two_products(sess):
    r = sess.get(f"{API}/products", timeout=30)
    prods = [p for p in r.json() if p.get("active", True)]
    assert len(prods) >= 2
    return prods[0], prods[1]


def free_table(sess):
    r = sess.get(f"{API}/tables", timeout=30)
    assert r.status_code == 200
    tables = r.json()
    for t in tables:
        if not t.get("open_orders"):
            return t
    return tables[0]


def make_order(sess, table_id, items):
    r = sess.post(f"{API}/orders", json={"table_id": table_id, "items": items}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def item(p, qty=1):
    return {"product_id": p["id"], "name": p["name"], "price": p["price"], "qty": qty,
            "workshop_id": p.get("workshop_id")}


# ---------- Printers: escape_t_value / codepage_label ----------
class TestPrinterEscT:
    def test_seeded_printers_have_esct_and_codepage(self, admin):
        r = admin.get(f"{API}/printers", timeout=30)
        assert r.status_code == 200, r.text
        printers = r.json()
        assert printers, "no printers seeded"
        for p in printers:
            assert p.get("escape_t_value") == 17, p
            assert p.get("codepage_label") == "cp866", p
            assert "_id" not in p
        ips = {p["local_ip"] for p in printers}
        assert "192.168.0.112" in ips and "192.168.0.111" in ips, ips

    def test_create_update_printer_persists_esct(self, admin):
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        payload = {"name": "TEST_Принтер_ESCT", "station": "kitchen",
                   "workshop_id": ws[0]["id"] if ws else None,
                   "local_ip": "192.168.0.199", "port": 9100,
                   "codepage_label": "cp1251", "escape_t_value": 6,
                   "paper_width_mm": 58, "active": True}
        r = admin.post(f"{API}/printers", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        try:
            got = admin.get(f"{API}/printers", timeout=30).json()
            mine = [p for p in got if p["id"] == pid][0]
            assert mine["escape_t_value"] == 6
            assert mine["codepage_label"] == "cp1251"

            payload.update({"escape_t_value": 17, "codepage_label": "cp866"})
            r = admin.patch(f"{API}/printers/{pid}", json=payload, timeout=30)
            assert r.status_code == 200, r.text
            got = admin.get(f"{API}/printers", timeout=30).json()
            mine = [p for p in got if p["id"] == pid][0]
            assert mine["escape_t_value"] == 17
            assert mine["codepage_label"] == "cp866"
        finally:
            admin.delete(f"{API}/printers/{pid}", timeout=30)

    def test_escpos_payload_has_esc_at_and_esc_t(self, admin, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        p = first_product(cashier)
        o = make_order(cashier, t["id"], [item(p)])
        try:
            r = cashier.post(f"{API}/orders/{o['id']}/send", timeout=60)
            assert r.status_code == 200, r.text
            time.sleep(1)
            jobs = admin.get(f"{API}/print-jobs", timeout=30).json()
            mine = [j for j in jobs if j.get("order_id") == o["id"]]
            assert mine, "no print job created for the sent order"
            raw = base64.b64decode(mine[0]["payload"]).hex()
            assert raw.startswith("1b40"), f"missing ESC @ init: {raw[:20]}"
            assert "1b7411" in raw[:40], f"missing ESC t 17: {raw[:40]}"
            assert raw.endswith("1d5600"), f"missing GS V 0 cut: {raw[-10:]}"
        finally:
            cashier.delete(f"{API}/orders/{o['id']}", timeout=30)


# ---------- Void last item auto-cancels order ----------
class TestVoidLastItem:
    def test_void_last_item_deletes_order(self, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        p = first_product(cashier)
        o = make_order(cashier, t["id"], [item(p)])
        cashier.post(f"{API}/orders/{o['id']}/send", timeout=60)
        r = cashier.request("DELETE", f"{API}/orders/{o['id']}/items/0",
                            json={"reason": "TEST_сторно"}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("deleted") is True, body
        assert body.get("order") is None, body
        # order really gone
        g = cashier.get(f"{API}/orders/{o['id']}", timeout=30)
        assert g.status_code == 404, f"order still exists: {g.status_code} {g.text[:200]}"

    def test_void_non_last_item_keeps_order(self, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        a, b = two_products(cashier)
        o = make_order(cashier, t["id"], [item(a), item(b)])
        try:
            r = cashier.delete(f"{API}/orders/{o['id']}/items/0", timeout=60)
            assert r.status_code == 200, r.text
            body = r.json()
            assert not body.get("deleted"), body
            assert body["order"] is not None
            assert len(body["order"]["items"]) == 1
            assert body["order"]["total"] == pytest.approx(b["price"])
        finally:
            cashier.delete(f"{API}/orders/{o['id']}", timeout=30)


# ---------- Split by cart-line index ----------
class TestSplitByIndex:
    def test_split_by_index_creates_second_bill_on_same_table(self, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        a, b = two_products(cashier)
        o = make_order(cashier, t["id"], [item(a), item(b)])
        new_id = None
        try:
            r = cashier.post(f"{API}/orders/{o['id']}/split", json={"indices": [1]}, timeout=30)
            assert r.status_code == 200, r.text
            body = r.json()
            new_id = body["split"]["id"]
            assert new_id, body
            src = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
            new = cashier.get(f"{API}/orders/{new_id}", timeout=30).json()
            assert [i["product_id"] for i in src["items"]] == [a["id"]]
            assert [i["product_id"] for i in new["items"]] == [b["id"]]
            assert src["total"] == pytest.approx(a["price"])
            assert new["total"] == pytest.approx(b["price"])
            assert new["table_id"] == t["id"]

            # tables endpoint must expose BOTH open orders + combined total
            tables = cashier.get(f"{API}/tables", timeout=30).json()
            mine = [x for x in tables if x["id"] == t["id"]][0]
            ids = {x["id"] for x in mine["open_orders"]}
            assert {o["id"], new_id} <= ids, ids
            assert mine["open_total"] == pytest.approx(a["price"] + b["price"])
        finally:
            cashier.delete(f"{API}/orders/{o['id']}", timeout=30)
            if new_id:
                cashier.delete(f"{API}/orders/{new_id}", timeout=30)

    def test_split_invalid_index_rejected(self, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        p = first_product(cashier)
        o = make_order(cashier, t["id"], [item(p)])
        try:
            r = cashier.post(f"{API}/orders/{o['id']}/split", json={"indices": [5]}, timeout=30)
            assert r.status_code in (400, 422), f"expected rejection, got {r.status_code} {r.text[:200]}"
            r = cashier.post(f"{API}/orders/{o['id']}/split", json={"indices": [0]}, timeout=30)
            assert r.status_code in (400, 422), "splitting ALL lines should be rejected"
        finally:
            cashier.delete(f"{API}/orders/{o['id']}", timeout=30)


# ---------- Auth: lockout never rejects valid credentials ----------
class TestLockoutRegression:
    def test_valid_pin_after_many_bad_pins(self):
        for _ in range(8):
            r = requests.post(f"{API}/auth/pin-login", json={"pin": "9999"}, timeout=30)
            assert r.status_code in (401, 429), r.status_code
        r = requests.post(f"{API}/auth/pin-login", json={"pin": "2222"}, timeout=30)
        assert r.status_code == 200, f"valid PIN rejected: {r.status_code} {r.text[:200]}"
        assert r.json()["user"]["role"] == "admin"
        r = requests.post(f"{API}/auth/pin-login", json={"pin": "1111"}, timeout=30)
        assert r.status_code == 200, f"valid PIN rejected: {r.status_code} {r.text[:200]}"
        assert r.json()["user"]["role"] == "waiter"

    def test_valid_admin_login_after_bad_passwords(self, test_credentials):
        for _ in range(8):
            r = requests.post(f"{API}/auth/login",
                              json={"email": test_credentials["email"], "password": "wrong-pass"},
                              timeout=30)
            assert r.status_code in (401, 429)
        r = requests.post(f"{API}/auth/login", json=test_credentials, timeout=30)
        assert r.status_code == 200, f"valid admin login rejected: {r.status_code} {r.text[:200]}"

    def test_lockout_triggers_for_bad_identity(self):
        codes = []
        for _ in range(8):
            r = requests.post(f"{API}/auth/login",
                              json={"email": "nobody-iter3@resto.com", "password": "x"}, timeout=30)
            codes.append(r.status_code)
        assert 429 in codes, f"no lockout after 8 failed attempts: {codes}"


# ---------- RBAC: shifts/open ----------
class TestShiftRbac:
    def test_waiter_cannot_open_shift(self, waiter):
        r = waiter.post(f"{API}/shifts/open", timeout=30)
        assert r.status_code == 403, f"waiter opened a shift: {r.status_code} {r.text[:200]}"

    def test_cashier_can_open_shift(self, cashier):
        s = ensure_shift(cashier)
        assert s.get("id")
        assert s.get("status") in ("open", None) or s.get("closed_at") is None


# ---------- Shift-close guard ----------
class TestShiftCloseGuard:
    def test_guard_blocks_then_allows(self, cashier):
        ensure_shift(cashier)
        t = free_table(cashier)
        p = first_product(cashier)
        o = make_order(cashier, t["id"], [item(p)])
        r = cashier.post(f"{API}/shifts/close", timeout=30)
        assert r.status_code == 400, f"guard did not block: {r.status_code} {r.text[:200]}"
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)
        r = cashier.post(f"{API}/shifts/close", timeout=30)
        assert r.status_code == 200, f"close failed after cleanup: {r.status_code} {r.text[:300]}"
        # reopen so other tests are not affected
        cashier.post(f"{API}/shifts/open", timeout=30)
