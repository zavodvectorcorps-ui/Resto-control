# Module: Phase 3 — Task 9 Refunds, Task 10 Service charge, Task 11 Reservations/Deposits, Task 13 Stop list
import datetime

import pytest
from conftest import API

TODAY = datetime.date.today().isoformat()


def _ensure_shift(cashier):
    cur = cashier.get(f"{API}/shifts/current", timeout=30).json()
    if not cur:
        r = cashier.post(f"{API}/shifts/open", timeout=30)
        assert r.status_code == 200, r.text
        return r.json()["id"]
    return cur["id"]


def _products(sess):
    return sess.get(f"{API}/products", timeout=30).json()


def _make_order(cashier, items, table_id=None):
    payload = {"items": items}
    if table_id:
        payload["table_id"] = table_id
    r = cashier.post(f"{API}/orders", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def created(request):
    store = {"orders": [], "reservations": [], "stopped": []}
    return store


# ------------------------- TASK 10: Service charge -------------------------
class TestServiceCharge:
    def test_settings_put_and_get(self, admin, cashier):
        r = admin.put(f"{API}/settings/service-charge",
                      json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)
        assert r.status_code == 200, r.text
        s = admin.get(f"{API}/settings", timeout=30)
        assert s.status_code == 200
        d = s.json()
        assert d["service_charge_percent"] == 10
        assert d["service_charge_default_enabled"] is False

    def test_service_charge_requires_manager(self, cashier):
        r = cashier.put(f"{API}/settings/service-charge",
                        json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)
        assert r.status_code == 403, f"cashier could change service charge: {r.status_code}"

    def test_per_order_toggle_and_pay_total(self, admin, cashier, created):
        _ensure_shift(cashier)
        admin.put(f"{API}/settings/service-charge",
                  json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)
        p = _products(cashier)[0]
        o = _make_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                   "price": p["price"], "count": 1}])
        created["orders"].append(o["id"])
        subtotal = o["subtotal"]

        t = cashier.patch(f"{API}/orders/{o['id']}/service-charge", json={"enabled": True}, timeout=30)
        assert t.status_code == 200, t.text
        got = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert got.get("is_service_charge_enabled") is True

        pay = cashier.post(f"{API}/orders/{o['id']}/pay",
                           json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert pay.status_code == 200, pay.text
        paid = pay.json()
        expected_sc = round(subtotal * 0.1, 2)
        assert paid["service_charge_amount"] == expected_sc, paid
        assert paid["total"] == round(subtotal + expected_sc, 2), paid
        # persisted
        again = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert again["total"] == round(subtotal + expected_sc, 2)

    def test_default_enabled_applies_when_not_set(self, admin, cashier, created):
        _ensure_shift(cashier)
        admin.put(f"{API}/settings/service-charge",
                  json={"service_charge_percent": 10, "service_charge_default_enabled": True}, timeout=30)
        try:
            p = _products(cashier)[0]
            o = _make_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                       "price": p["price"], "count": 2}])
            created["orders"].append(o["id"])
            subtotal = o["subtotal"]
            paid = cashier.post(f"{API}/orders/{o['id']}/pay",
                                json={"payment_method": "cash"}, timeout=30)
            assert paid.status_code == 200, paid.text
            body = paid.json()
            assert body["service_charge_amount"] == round(subtotal * 0.1, 2), body
            assert body["total"] == round(subtotal * 1.1, 2), body
        finally:
            admin.put(f"{API}/settings/service-charge",
                      json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)

    def test_disabled_toggle_no_charge(self, admin, cashier, created):
        _ensure_shift(cashier)
        admin.put(f"{API}/settings/service-charge",
                  json={"service_charge_percent": 10, "service_charge_default_enabled": True}, timeout=30)
        try:
            p = _products(cashier)[0]
            o = _make_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                       "price": p["price"], "count": 1}])
            created["orders"].append(o["id"])
            cashier.patch(f"{API}/orders/{o['id']}/service-charge", json={"enabled": False}, timeout=30)
            body = cashier.post(f"{API}/orders/{o['id']}/pay",
                                json={"payment_method": "cash"}, timeout=30).json()
            assert body["service_charge_amount"] == 0.0, body
            assert body["total"] == o["subtotal"], body
        finally:
            admin.put(f"{API}/settings/service-charge",
                      json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)

    def test_toggle_unknown_order_404(self, cashier):
        r = cashier.patch(f"{API}/orders/000000000000000000000000/service-charge",
                          json={"enabled": True}, timeout=30)
        assert r.status_code == 404, r.status_code


# ------------------------- TASK 9: Refunds -------------------------
class TestRefunds:
    def test_refund_partial_then_full(self, admin, cashier, created):
        _ensure_shift(cashier)
        prods = _products(cashier)
        p1, p2 = prods[0], prods[1]
        items = [
            {"product_id": p1["id"], "name": p1["name"], "price": p1["price"], "count": 2},
            {"product_id": p2["id"], "name": p2["name"], "price": p2["price"], "count": 1},
        ]
        o = _make_order(cashier, items)
        oid = o["id"]
        created["orders"].append(oid)

        # refund on open order -> 400
        bad = cashier.post(f"{API}/orders/{oid}/refund",
                           json={"items": [{"index": 0, "qty": 1}], "reason": "TEST_early"}, timeout=30)
        assert bad.status_code == 400, f"refund allowed on non-closed order: {bad.status_code}"

        pay = cashier.post(f"{API}/orders/{oid}/pay", json={"payment_method": "cash"}, timeout=30)
        assert pay.status_code == 200, pay.text

        # bad index
        bi = cashier.post(f"{API}/orders/{oid}/refund",
                          json={"items": [{"index": 99, "qty": 1}], "reason": "TEST_badidx"}, timeout=30)
        assert bi.status_code == 400, bi.status_code

        # partial refund: 1 of item 0
        r1 = cashier.post(f"{API}/orders/{oid}/refund",
                          json={"items": [{"index": 0, "qty": 1}], "reason": "TEST_partial"}, timeout=30)
        assert r1.status_code == 200, r1.text
        ref = r1.json()
        assert ref["amount"] == round(p1["price"], 2), ref
        assert ref["reason"] == "TEST_partial"
        assert ref["items"][0]["name"] == p1["name"]
        assert "_id" not in ref
        assert cashier.get(f"{API}/orders/{oid}", timeout=30).json()["status"] == "closed"

        # remaining refund -> status refunded
        r2 = cashier.post(f"{API}/orders/{oid}/refund",
                          json={"items": [{"index": 0, "qty": 1}, {"index": 1, "qty": 1}],
                                "reason": "TEST_rest"}, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["amount"] == round(p1["price"] + p2["price"], 2), r2.json()
        assert cashier.get(f"{API}/orders/{oid}", timeout=30).json()["status"] == "refunded"

        # corrections logged
        corr = admin.get(f"{API}/reports/corrections", timeout=30)
        if corr.status_code == 200:
            rows = corr.json().get("rows", corr.json()) if isinstance(corr.json(), dict) else corr.json()
            assert any("Возврат" in (c.get("reason") or "") for c in rows), "no correction logged for refund"

    def test_refund_requires_admin_role(self, admin, waiter, created):
        orders = admin.get(f"{API}/orders", timeout=30).json()
        closed = next((o for o in orders if o.get("status") in ("closed", "refunded")), None)
        assert closed, "no closed order to test role restriction"
        r = waiter.post(f"{API}/orders/{closed['id']}/refund",
                        json={"items": [{"index": 0, "qty": 1}], "reason": "TEST_role"}, timeout=30)
        assert r.status_code == 403, f"waiter allowed refund: {r.status_code}"
        m = admin.post(f"{API}/orders/{closed['id']}/refund",
                       json={"items": [{"index": 0, "qty": 1}], "reason": "TEST_role"}, timeout=30)
        assert m.status_code == 403, f"manager allowed refund: {m.status_code}"

    def test_refund_unknown_order_404(self, cashier):
        r = cashier.post(f"{API}/orders/000000000000000000000000/refund",
                         json={"items": [{"index": 0, "qty": 1}], "reason": "TEST_404"}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_refunds_report(self, admin, cashier):
        r = admin.get(f"{API}/reports/refunds", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d and "total" in d
        assert isinstance(d["rows"], list)
        assert d["total"] == round(sum(x["amount"] for x in d["rows"]), 2)
        assert all("_id" not in x for x in d["rows"])
        # date filter
        f = admin.get(f"{API}/reports/refunds", params={"start": TODAY, "end": TODAY}, timeout=30)
        assert f.status_code == 200
        assert len(f.json()["rows"]) >= 1
        empty = admin.get(f"{API}/reports/refunds",
                          params={"start": "2000-01-01", "end": "2000-01-02"}, timeout=30)
        assert empty.json()["rows"] == [] and empty.json()["total"] == 0
        # role
        assert cashier.get(f"{API}/reports/refunds", timeout=30).status_code == 403


# ------------------------- TASK 11: Reservations -------------------------
class TestReservations:
    def test_reservation_crud(self, admin, created):
        tables = admin.get(f"{API}/tables", timeout=30).json()
        tid = tables[0]["id"]
        payload = {"table_id": tid, "date": TODAY, "time_from": "19:00", "time_to": "21:00",
                   "guest_name": "TEST_Гость", "guest_phone": "+70000000000",
                   "guests_count": 4, "deposit_amount": 500}
        c = admin.post(f"{API}/reservations", json=payload, timeout=30)
        assert c.status_code == 200, c.text
        rv = c.json()
        created["reservations"].append(rv["id"])
        assert rv["status"] == "pending"
        assert rv["guest_name"] == "TEST_Гость"
        assert rv["deposit_amount"] == 500
        assert rv["hall"] == tables[0].get("hall")
        assert "_id" not in rv

        lst = admin.get(f"{API}/reservations", params={"date": TODAY}, timeout=30)
        assert lst.status_code == 200
        assert any(x["id"] == rv["id"] for x in lst.json())
        other = admin.get(f"{API}/reservations", params={"date": "2000-01-01"}, timeout=30).json()
        assert all(x["id"] != rv["id"] for x in other)

        pa = admin.patch(f"{API}/reservations/{rv['id']}",
                         json={"status": "confirmed", "deposit_amount": 700}, timeout=30)
        assert pa.status_code == 200, pa.text
        assert pa.json()["status"] == "confirmed" and pa.json()["deposit_amount"] == 700
        fetched = next(x for x in admin.get(f"{API}/reservations", timeout=30).json() if x["id"] == rv["id"])
        assert fetched["status"] == "confirmed" and fetched["deposit_amount"] == 700

        assert admin.patch(f"{API}/reservations/000000000000000000000000",
                           json={"status": "confirmed"}, timeout=30).status_code == 404
        assert admin.delete(f"{API}/reservations/000000000000000000000000", timeout=30).status_code == 404

        d = admin.delete(f"{API}/reservations/{rv['id']}", timeout=30)
        assert d.status_code == 200, d.text
        created["reservations"].remove(rv["id"])
        assert all(x["id"] != rv["id"] for x in admin.get(f"{API}/reservations", timeout=30).json())

    def test_link_reservation_deposit_applied_on_pay(self, admin, cashier, created):
        _ensure_shift(cashier)
        prods = _products(cashier)
        p = next((x for x in prods if x["price"] >= 100), prods[0])
        rv = admin.post(f"{API}/reservations", json={
            "date": TODAY, "time_from": "20:00", "guest_name": "TEST_Депозит",
            "guests_count": 2, "deposit_amount": 5}, timeout=30).json()
        created["reservations"].append(rv["id"])

        o = _make_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                   "price": p["price"], "count": 2}])
        created["orders"].append(o["id"])
        subtotal = o["subtotal"]
        lk = cashier.post(f"{API}/orders/{o['id']}/link-reservation",
                          json={"reservation_id": rv["id"]}, timeout=30)
        assert lk.status_code == 200, lk.text
        got = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert got.get("prepaid_amount") == 5, got

        seated = next(x for x in admin.get(f"{API}/reservations", timeout=30).json() if x["id"] == rv["id"])
        assert seated["status"] == "seated"
        assert seated["order_id"] == o["id"]

        paid = cashier.post(f"{API}/orders/{o['id']}/pay",
                            json={"payment_method": "cash"}, timeout=30)
        assert paid.status_code == 200, paid.text
        body = paid.json()
        assert body["prepaid_amount"] == 5
        assert body["total"] == round(subtotal - 5, 2), body

        bad = cashier.post(f"{API}/orders/{o['id']}/link-reservation",
                           json={"reservation_id": "000000000000000000000000"}, timeout=30)
        assert bad.status_code == 404, bad.status_code


# ------------------------- TASK 13: Stop list -------------------------
class TestStopList:
    def test_stop_list_crud_and_products_flag(self, cashier, created):
        _ensure_shift(cashier)
        prods = _products(cashier)
        pid = prods[0]["id"]
        base = cashier.get(f"{API}/pos/stop-list", timeout=30)
        assert base.status_code == 200 and isinstance(base.json(), list)

        a = cashier.post(f"{API}/pos/stop-list/{pid}", timeout=30)
        assert a.status_code == 200, a.text
        created["stopped"].append(pid)
        sl = cashier.get(f"{API}/pos/stop-list", timeout=30).json()
        assert any(x["product_id"] == pid for x in sl), sl
        assert all("_id" not in x for x in sl)
        entry = next(x for x in sl if x["product_id"] == pid)
        assert entry.get("session_id"), "stop-list entry has no session_id while a shift is open"

        after = _products(cashier)
        target = next(x for x in after if x["id"] == pid)
        assert target["is_available"] is False, target
        assert all(x["is_available"] is not False for x in after if x["id"] != pid)

        # idempotent add
        assert cashier.post(f"{API}/pos/stop-list/{pid}", timeout=30).status_code == 200
        assert len([x for x in cashier.get(f"{API}/pos/stop-list", timeout=30).json()
                    if x["product_id"] == pid]) == 1

        d = cashier.delete(f"{API}/pos/stop-list/{pid}", timeout=30)
        assert d.status_code == 200
        created["stopped"].remove(pid)
        assert all(x["product_id"] != pid for x in cashier.get(f"{API}/pos/stop-list", timeout=30).json())
        assert next(x for x in _products(cashier) if x["id"] == pid)["is_available"] is not False

    def test_new_shift_clears_stop_list(self, cashier):
        _ensure_shift(cashier)
        pid = _products(cashier)[0]["id"]
        cashier.post(f"{API}/pos/stop-list/{pid}", timeout=30)
        assert len(cashier.get(f"{API}/pos/stop-list", timeout=30).json()) >= 1
        assert cashier.post(f"{API}/shifts/close", timeout=30).status_code == 200
        r = cashier.post(f"{API}/shifts/open", timeout=30)
        assert r.status_code == 200, r.text
        assert cashier.get(f"{API}/pos/stop-list", timeout=30).json() == [], "stop list not cleared on new shift"


# ------------------------- Cleanup -------------------------
class TestZCleanup:
    def test_cleanup(self, admin, cashier, created):
        for rid_ in list(created["reservations"]):
            admin.delete(f"{API}/reservations/{rid_}", timeout=30)
        for pid in list(created["stopped"]):
            cashier.delete(f"{API}/pos/stop-list/{pid}", timeout=30)
        admin.put(f"{API}/settings/service-charge",
                  json={"service_charge_percent": 10, "service_charge_default_enabled": False}, timeout=30)
        s = admin.get(f"{API}/settings", timeout=30).json()
        assert s["service_charge_default_enabled"] is False
