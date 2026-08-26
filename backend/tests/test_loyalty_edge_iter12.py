"""Iteration 12 hardening probes — expected to FAIL where they pin real defects."""
import datetime as dt

import pytest

from conftest import API


def _ensure_shift(cashier):
    r = cashier.get(f"{API}/shifts/current", timeout=30)
    if r.status_code == 200 and r.json():
        return
    cashier.post(f"{API}/shifts/open", json={"opening_cash": 1000}, timeout=30)


@pytest.fixture
def cleanup(admin):
    reg = []
    yield reg
    for path, i in reg:
        admin.delete(f"{API}/{path}/{i}", timeout=30)


class TestEdgeIter12:
    def test_overnight_time_window_promo_is_active(self, admin, cleanup):
        """A promo 22:00-02:00 must be active at 23:00 (window crossing midnight)."""
        now = dt.datetime.utcnow()
        t_from = (now - dt.timedelta(hours=1)).strftime("%H:00")
        t_to = (now + dt.timedelta(hours=3)).strftime("%H:00")
        if t_from < t_to:
            pytest.skip("current UTC time does not produce an overnight window")
        p = admin.post(f"{API}/promotions", json={
            "name": "TEST_Ночная", "active": True, "time_from": t_from, "time_to": t_to,
            "result_type": "discount_percent", "result_value": 5.0, "auto_apply": False}, timeout=30).json()
        cleanup.append(("promotions", p["id"]))
        ids = [x["id"] for x in admin.get(f"{API}/promotions/active", timeout=30).json()]
        assert p["id"] in ids, f"overnight window {t_from}-{t_to} not treated as active at {now:%H:%M}"

    def test_negative_promo_result_value_rejected(self, admin, cleanup):
        r = admin.post(f"{API}/promotions", json={
            "name": "TEST_Отрицательная", "active": True,
            "result_type": "discount_percent", "result_value": -50.0, "auto_apply": False}, timeout=30)
        if r.status_code == 200:
            cleanup.append(("promotions", r.json()["id"]))
        assert r.status_code == 400, f"negative discount_percent accepted ({r.status_code})"

    def test_promo_percent_over_100_rejected(self, admin, cleanup):
        r = admin.post(f"{API}/promotions", json={
            "name": "TEST_200pct", "active": True,
            "result_type": "discount_percent", "result_value": 200.0, "auto_apply": False}, timeout=30)
        if r.status_code == 200:
            cleanup.append(("promotions", r.json()["id"]))
        assert r.status_code == 400, f"result_value=200% accepted ({r.status_code})"

    def test_promo_result_type_validated(self, admin, cleanup):
        r = admin.post(f"{API}/promotions", json={
            "name": "TEST_BogusType", "active": True, "result_type": "bogus",
            "result_value": 5.0, "auto_apply": False}, timeout=30)
        if r.status_code == 200:
            cleanup.append(("promotions", r.json()["id"]))
        assert r.status_code in (400, 422), f"result_type='bogus' accepted ({r.status_code})"

    def test_promo_weekday_range_validated(self, admin, cleanup):
        r = admin.post(f"{API}/promotions", json={
            "name": "TEST_WD99", "active": True, "weekdays": [99],
            "result_type": "discount_percent", "result_value": 5.0, "auto_apply": False}, timeout=30)
        if r.status_code == 200:
            cleanup.append(("promotions", r.json()["id"]))
        assert r.status_code in (400, 422), f"weekdays=[99] accepted ({r.status_code})"

    def test_loyalty_group_type_validated(self, admin, cleanup):
        r = admin.post(f"{API}/loyalty-groups", json={"name": "TEST_BogusGrp", "type": "bogus",
                                                      "value_percent": 5}, timeout=30)
        if r.status_code == 200:
            cleanup.append(("loyalty-groups", r.json()["id"]))
        assert r.status_code in (400, 422), f"loyalty group type='bogus' accepted ({r.status_code})"

    def test_bonus_cannot_go_negative(self, admin, cleanup):
        c = admin.post(f"{API}/clients", json={"name": "TEST_NegBal", "phone": "+7 900 333-22-11",
                                               "discount_percent": 0}, timeout=30).json()
        cleanup.append(("clients", c["id"]))
        r = admin.post(f"{API}/clients/{c['id']}/bonus", json={"amount": -1000}, timeout=30)
        assert r.status_code == 400 or (r.status_code == 200 and r.json()["bonus_balance"] >= 0), \
            f"bonus balance driven negative: {r.status_code} {r.text[:120]}"

    def test_delete_unknown_loyalty_group_404(self, admin):
        r = admin.delete(f"{API}/loyalty-groups/507f1f77bcf86cd799439011", timeout=30)
        assert r.status_code == 404, f"got {r.status_code}"

    def test_yield_for_pcs_ingredient_not_zero(self, admin, cleanup):
        """Recipe in pcs -> yield 0 g; UI shows 'Выход 0 г' which is misleading."""
        inv = admin.post(f"{API}/inventory", json={"name": "TEST_Яйцо", "measure": "pcs",
                                                   "balance": 100, "cost": 0.2}, timeout=30).json()
        cleanup.append(("inventory", inv["id"]))
        p = admin.post(f"{API}/products", json={
            "name": "TEST_Омлет", "price": 5.0, "cost_source": "auto",
            "recipe": [{"inventory_id": inv["id"], "name": "TEST_Яйцо", "amount": 3, "unit": "pcs"}]},
            timeout=30).json()
        cleanup.append(("products", p["id"]))
        assert p["yield_g"] != 0.0, "yield_g computed as 0 for a pcs-only recipe"
