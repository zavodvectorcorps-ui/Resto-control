"""Iteration 12 — Task 6 (бонусы/акции), Task 7 (брутто/нетто), Task 8 (отчёты), switcher."""
import datetime as dt

import pytest
import requests

from conftest import API


def _ensure_shift(cashier):
    r = cashier.get(f"{API}/shifts/current", timeout=30)
    if r.status_code == 200 and r.json():
        return
    cashier.post(f"{API}/shifts/open", json={"opening_cash": 1000}, timeout=30)


@pytest.fixture(scope="module")
def created(admin):
    reg = {"loyalty-groups": [], "promotions": [], "clients": [], "products": [], "inventory": []}
    yield reg
    for path, ids in reg.items():
        for i in ids:
            try:
                admin.delete(f"{API}/{path}/{i}", timeout=30)
            except Exception:
                pass


# ---------- Loyalty groups CRUD ----------
class TestLoyaltyGroups:
    def test_seeded_group_present(self, admin):
        r = admin.get(f"{API}/loyalty-groups", timeout=30)
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list)
        for g in groups:
            assert "_id" not in g and "id" in g
        seeded = [g for g in groups if g["name"] == "Бонусный клуб"]
        assert seeded, f"seeded group missing: {[g['name'] for g in groups]}"
        assert seeded[0]["type"] == "bonus"
        assert seeded[0]["value_percent"] == 5.0

    def test_crud_group(self, admin, created):
        r = admin.post(f"{API}/loyalty-groups",
                       json={"name": "TEST_Скидочники", "type": "discount", "value_percent": 7.5}, timeout=30)
        assert r.status_code == 200, r.text
        g = r.json()
        gid = g["id"]
        created["loyalty-groups"].append(gid)
        assert g["name"] == "TEST_Скидочники" and g["type"] == "discount" and g["value_percent"] == 7.5

        # GET verify persistence
        lst = admin.get(f"{API}/loyalty-groups", timeout=30).json()
        got = [x for x in lst if x["id"] == gid]
        assert got and got[0]["value_percent"] == 7.5

        # UPDATE
        u = admin.put(f"{API}/loyalty-groups/{gid}",
                      json={"name": "TEST_Скидочники2", "type": "bonus", "value_percent": 3.0}, timeout=30)
        assert u.status_code == 200, u.text
        assert u.json()["name"] == "TEST_Скидочники2" and u.json()["type"] == "bonus"
        lst = admin.get(f"{API}/loyalty-groups", timeout=30).json()
        got = [x for x in lst if x["id"] == gid][0]
        assert got["name"] == "TEST_Скидочники2" and got["value_percent"] == 3.0

        # DELETE
        d = admin.delete(f"{API}/loyalty-groups/{gid}", timeout=30)
        assert d.status_code == 200, d.text
        created["loyalty-groups"].remove(gid)
        lst = admin.get(f"{API}/loyalty-groups", timeout=30).json()
        assert not [x for x in lst if x["id"] == gid]

    def test_update_unknown_404(self, admin):
        r = admin.put(f"{API}/loyalty-groups/507f1f77bcf86cd799439011",
                      json={"name": "x", "type": "bonus", "value_percent": 1}, timeout=30)
        assert r.status_code == 404, r.status_code

    def test_delete_unknown_404(self, admin):
        r = admin.delete(f"{API}/loyalty-groups/507f1f77bcf86cd799439011", timeout=30)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:200]}"

    def test_manager_only(self, cashier, waiter):
        for s in (cashier, waiter):
            assert s.get(f"{API}/loyalty-groups", timeout=30).status_code == 200
            assert s.post(f"{API}/loyalty-groups",
                          json={"name": "TEST_x", "type": "bonus", "value_percent": 1},
                          timeout=30).status_code == 403
            assert s.put(f"{API}/loyalty-groups/507f1f77bcf86cd799439011",
                         json={"name": "x", "type": "bonus", "value_percent": 1},
                         timeout=30).status_code == 403
            assert s.delete(f"{API}/loyalty-groups/507f1f77bcf86cd799439011", timeout=30).status_code == 403

    def test_delete_group_clears_client_reference(self, admin, created):
        g = admin.post(f"{API}/loyalty-groups",
                       json={"name": "TEST_Каскад", "type": "bonus", "value_percent": 2}, timeout=30).json()
        gid = g["id"]
        c = admin.post(f"{API}/clients", json={"name": "TEST_Каскад Клиент", "phone": "+7 900 000-11-22",
                                               "discount_percent": 0, "loyalty_group_id": gid}, timeout=30)
        assert c.status_code == 200, c.text
        cid = c.json()["id"]
        created["clients"].append(cid)
        admin.delete(f"{API}/loyalty-groups/{gid}", timeout=30)
        cl = [x for x in admin.get(f"{API}/clients", timeout=30).json() if x["id"] == cid][0]
        assert cl.get("loyalty_group_id") in (None, ""), cl.get("loyalty_group_id")


# ---------- Promotions ----------
class TestPromotions:
    def test_seeded_promo(self, admin):
        r = admin.get(f"{API}/promotions", timeout=30)
        assert r.status_code == 200
        promos = r.json()
        seeded = [p for p in promos if "Счастливые часы" in p["name"]]
        assert seeded, [p["name"] for p in promos]
        p = seeded[0]
        assert p["result_type"] == "discount_percent"
        assert p["result_value"] == 15.0
        assert p["time_from"] == "14:00" and p["time_to"] == "17:00"

    def test_crud_promo(self, admin, created):
        payload = {"name": "TEST_Промо", "active": True, "weekdays": [0, 1, 2, 3, 4, 5, 6],
                   "time_from": "00:00", "time_to": "23:59", "result_type": "discount_percent",
                   "result_value": 10.0, "auto_apply": False, "stackable": False}
        r = admin.post(f"{API}/promotions", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        pm = r.json()
        pid = pm["id"]
        created["promotions"].append(pid)
        assert "_id" not in pm
        assert pm["result_value"] == 10.0 and pm["weekdays"] == [0, 1, 2, 3, 4, 5, 6]

        u = admin.put(f"{API}/promotions/{pid}", json={**payload, "result_value": 20.0, "active": False}, timeout=30)
        assert u.status_code == 200, u.text
        assert u.json()["result_value"] == 20.0 and u.json()["active"] is False
        lst = admin.get(f"{API}/promotions", timeout=30).json()
        got = [x for x in lst if x["id"] == pid][0]
        assert got["result_value"] == 20.0 and got["active"] is False

        d = admin.delete(f"{API}/promotions/{pid}", timeout=30)
        assert d.status_code == 200
        created["promotions"].remove(pid)
        assert not [x for x in admin.get(f"{API}/promotions", timeout=30).json() if x["id"] == pid]

    def test_unknown_404(self, admin):
        assert admin.put(f"{API}/promotions/507f1f77bcf86cd799439011",
                         json={"name": "x"}, timeout=30).status_code == 404
        assert admin.delete(f"{API}/promotions/507f1f77bcf86cd799439011", timeout=30).status_code == 404

    def test_manager_only(self, cashier):
        assert cashier.get(f"{API}/promotions", timeout=30).status_code == 200
        assert cashier.post(f"{API}/promotions", json={"name": "TEST_x"}, timeout=30).status_code == 403
        assert cashier.delete(f"{API}/promotions/507f1f77bcf86cd799439011", timeout=30).status_code == 403

    def test_active_filter(self, admin, created):
        now = dt.datetime.utcnow()
        wd = now.weekday()
        # active now
        p_now = admin.post(f"{API}/promotions", json={
            "name": "TEST_Активная", "active": True, "weekdays": [wd],
            "time_from": "00:00", "time_to": "23:59",
            "result_type": "discount_percent", "result_value": 5.0, "auto_apply": False}, timeout=30).json()
        created["promotions"].append(p_now["id"])
        # inactive flag
        p_off = admin.post(f"{API}/promotions", json={
            "name": "TEST_Выключена", "active": False, "result_type": "discount_percent",
            "result_value": 5.0, "auto_apply": False}, timeout=30).json()
        created["promotions"].append(p_off["id"])
        # wrong weekday
        p_wd = admin.post(f"{API}/promotions", json={
            "name": "TEST_ДругойДень", "active": True, "weekdays": [(wd + 3) % 7],
            "result_type": "discount_percent", "result_value": 5.0, "auto_apply": False}, timeout=30).json()
        created["promotions"].append(p_wd["id"])
        # expired date window
        p_old = admin.post(f"{API}/promotions", json={
            "name": "TEST_Просрочена", "active": True,
            "date_from": "2020-01-01", "date_to": "2020-12-31",
            "result_type": "discount_percent", "result_value": 5.0, "auto_apply": False}, timeout=30).json()
        created["promotions"].append(p_old["id"])

        r = admin.get(f"{API}/promotions/active", timeout=30)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert p_now["id"] in ids
        assert p_off["id"] not in ids
        assert p_wd["id"] not in ids
        assert p_old["id"] not in ids


# ---------- Client bonus ----------
class TestClientBonus:
    def test_bonus_adjust_and_transactions(self, admin, created):
        c = admin.post(f"{API}/clients", json={"name": "TEST_Бонус Клиент", "phone": "+7 900 555-44-33",
                                               "discount_percent": 0}, timeout=30)
        assert c.status_code == 200, c.text
        cid = c.json()["id"]
        created["clients"].append(cid)
        assert c.json().get("bonus_balance") == 0.0

        r = admin.post(f"{API}/clients/{cid}/bonus", json={"amount": 50, "note": "TEST_начисление"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["bonus_balance"] == 50.0

        r = admin.post(f"{API}/clients/{cid}/bonus", json={"amount": -20.5, "note": "TEST_списание"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["bonus_balance"] == 29.5

        cl = [x for x in admin.get(f"{API}/clients", timeout=30).json() if x["id"] == cid][0]
        assert cl["bonus_balance"] == 29.5

        t = admin.get(f"{API}/clients/{cid}/transactions", timeout=30)
        assert t.status_code == 200, t.text
        txns = t.json()
        assert len(txns) == 2
        for x in txns:
            assert "_id" not in x
            assert x["client_id"] == cid
        amounts = sorted(x["amount"] for x in txns)
        assert amounts == [-20.5, 50.0]
        assert 29.5 in [x["balance_after"] for x in txns]

    def test_bonus_unknown_client_404(self, admin):
        r = admin.post(f"{API}/clients/507f1f77bcf86cd799439011/bonus", json={"amount": 5}, timeout=30)
        assert r.status_code == 404

    def test_bonus_manager_only(self, cashier, waiter):
        for s in (cashier, waiter):
            r = s.post(f"{API}/clients/507f1f77bcf86cd799439011/bonus", json={"amount": 5}, timeout=30)
            assert r.status_code == 403, r.status_code


# ---------- Settings ----------
class TestSettings:
    def test_max_bonus_setting_roundtrip(self, admin):
        s = admin.get(f"{API}/settings", timeout=30)
        assert s.status_code == 200
        original = s.json().get("max_bonus_payment_percent")
        assert original is not None
        try:
            r = admin.put(f"{API}/settings/receipt", json={"max_bonus_payment_percent": 40}, timeout=30)
            assert r.status_code == 200, r.text
            got = admin.get(f"{API}/settings", timeout=30).json()
            assert got["max_bonus_payment_percent"] == 40
            # receipt text fields must not be wiped by a partial update
            assert isinstance(got["name"], str)
        finally:
            admin.put(f"{API}/settings/receipt", json={"max_bonus_payment_percent": original}, timeout=30)
        assert admin.get(f"{API}/settings", timeout=30).json()["max_bonus_payment_percent"] == original

    def test_settings_receipt_manager_only(self, cashier):
        r = cashier.put(f"{API}/settings/receipt", json={"max_bonus_payment_percent": 10}, timeout=30)
        assert r.status_code == 403


# ---------- Pay: bonus redeem + cashback ----------
def _make_order(session, items):
    r = session.post(f"{API}/orders", json={"items": items}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestPayBonus:
    def test_redeem_capped_and_cashback(self, admin, cashier, created):
        _ensure_shift(cashier)
        settings = admin.get(f"{API}/settings", timeout=30).json()
        max_pct = settings["max_bonus_payment_percent"]

        grp = admin.post(f"{API}/loyalty-groups",
                         json={"name": "TEST_Кэшбэк", "type": "bonus", "value_percent": 5.0}, timeout=30).json()
        created["loyalty-groups"].append(grp["id"])
        cl = admin.post(f"{API}/clients", json={"name": "TEST_Redeem", "phone": "+7 900 777-88-99",
                                                "discount_percent": 0,
                                                "loyalty_group_id": grp["id"]}, timeout=30).json()
        cid = cl["id"]
        created["clients"].append(cid)
        admin.post(f"{API}/clients/{cid}/bonus", json={"amount": 100}, timeout=30)

        prod = admin.post(f"{API}/products", json={"name": "TEST_Латте", "price": 4.5,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])

        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 4.5, "count": 1}])
        assert o["subtotal"] == 4.5
        pay = cashier.post(f"{API}/orders/{o['id']}/pay",
                           json={"payment_method": "cash", "client_id": cid,
                                 "bonus_redeem_amount": 20}, timeout=30)
        assert pay.status_code == 200, pay.text
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        base = round(4.5 - (order.get("promo_discount") or 0), 2)
        expected_cap = round(base * max_pct / 100, 2)
        assert order["bonus_redeemed"] == expected_cap, order
        assert order["total"] == round(base - expected_cap, 2)

        expected_cashback = round(order["total"] * 5.0 / 100, 2)
        bal = [x for x in admin.get(f"{API}/clients", timeout=30).json() if x["id"] == cid][0]["bonus_balance"]
        assert bal == round(100 - expected_cap + expected_cashback, 2), bal

        txns = admin.get(f"{API}/clients/{cid}/transactions", timeout=30).json()
        kinds = {t["type"] for t in txns}
        assert "redemption" in kinds and "accrual" in kinds
        red = [t for t in txns if t["type"] == "redemption"][0]
        acc = [t for t in txns if t["type"] == "accrual" and t.get("order_id")][0]
        assert red["amount"] == expected_cap
        assert red["order_id"] == o["id"]
        assert acc["amount"] == expected_cashback

    def test_redeem_cannot_exceed_balance(self, admin, cashier, created):
        _ensure_shift(cashier)
        cl = admin.post(f"{API}/clients", json={"name": "TEST_SmallBal", "phone": "+7 900 111-99-88",
                                                "discount_percent": 0}, timeout=30).json()
        cid = cl["id"]
        created["clients"].append(cid)
        admin.post(f"{API}/clients/{cid}/bonus", json={"amount": 1}, timeout=30)
        prod = admin.post(f"{API}/products", json={"name": "TEST_Чай", "price": 100.0,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])
        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 100.0, "count": 1}])
        pay = cashier.post(f"{API}/orders/{o['id']}/pay",
                           json={"payment_method": "cash", "client_id": cid,
                                 "bonus_redeem_amount": 999}, timeout=30)
        assert pay.status_code == 200, pay.text
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert order["bonus_redeemed"] == 1.0
        assert order["total"] == round(100.0 - (order.get("promo_discount") or 0) - 1.0, 2)
        bal = [x for x in admin.get(f"{API}/clients", timeout=30).json() if x["id"] == cid][0]["bonus_balance"]
        assert bal == 0.0

    def test_negative_redeem_ignored(self, admin, cashier, created):
        _ensure_shift(cashier)
        cl = admin.post(f"{API}/clients", json={"name": "TEST_Neg", "phone": "+7 900 222-33-11",
                                                "discount_percent": 0}, timeout=30).json()
        cid = cl["id"]
        created["clients"].append(cid)
        admin.post(f"{API}/clients/{cid}/bonus", json={"amount": 10}, timeout=30)
        prod = admin.post(f"{API}/products", json={"name": "TEST_Кофе", "price": 10.0,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])
        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 10.0, "count": 1}])
        pay = cashier.post(f"{API}/orders/{o['id']}/pay",
                           json={"payment_method": "cash", "client_id": cid,
                                 "bonus_redeem_amount": -50}, timeout=30)
        assert pay.status_code == 200, pay.text
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert order["bonus_redeemed"] == 0.0
        assert order["total"] == round(10.0 - (order.get("promo_discount") or 0), 2)


# ---------- Pay: auto promotion ----------
class TestPayPromotion:
    def test_auto_promo_applies(self, admin, cashier, created):
        _ensure_shift(cashier)
        wd = dt.datetime.utcnow().weekday()
        promo = admin.post(f"{API}/promotions", json={
            "name": "TEST_Авто20", "active": True, "weekdays": [wd],
            "time_from": "00:00", "time_to": "23:59",
            "result_type": "discount_percent", "result_value": 20.0,
            "auto_apply": True, "stackable": False}, timeout=30).json()
        created["promotions"].append(promo["id"])
        prod = admin.post(f"{API}/products", json={"name": "TEST_Пицца", "price": 50.0,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])
        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 50.0, "count": 1}])
        pay = cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash"}, timeout=30)
        assert pay.status_code == 200, pay.text
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        aps = order.get("applied_promotions") or []
        mine = [a for a in aps if a["promotion_id"] == promo["id"]]
        assert mine, aps
        assert mine[0]["discount_amount"] == 10.0
        assert order["promo_discount"] >= 10.0
        assert order["total"] == round(50.0 - order["promo_discount"], 2)
        admin.delete(f"{API}/promotions/{promo['id']}", timeout=30)
        created["promotions"].remove(promo["id"])

    def test_non_stackable_stops_after_first(self, admin, cashier, created):
        _ensure_shift(cashier)
        wd = dt.datetime.utcnow().weekday()
        p1 = admin.post(f"{API}/promotions", json={
            "name": "TEST_NS1", "active": True, "weekdays": [wd],
            "result_type": "discount_percent", "result_value": 10.0,
            "auto_apply": True, "stackable": False}, timeout=30).json()
        p2 = admin.post(f"{API}/promotions", json={
            "name": "TEST_NS2", "active": True, "weekdays": [wd],
            "result_type": "discount_percent", "result_value": 30.0,
            "auto_apply": True, "stackable": False}, timeout=30).json()
        created["promotions"] += [p1["id"], p2["id"]]
        prod = admin.post(f"{API}/products", json={"name": "TEST_Суп", "price": 100.0,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])
        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 100.0, "count": 1}])
        cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash"}, timeout=30)
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        aps = order.get("applied_promotions") or []
        assert len(aps) == 1, aps
        for pid in (p1["id"], p2["id"]):
            admin.delete(f"{API}/promotions/{pid}", timeout=30)
            created["promotions"].remove(pid)

    def test_promo_condition_min_qty_blocks(self, admin, cashier, created):
        _ensure_shift(cashier)
        wd = dt.datetime.utcnow().weekday()
        prod = admin.post(f"{API}/products", json={"name": "TEST_Ролл", "price": 20.0,
                                                   "cost_source": "manual"}, timeout=30).json()
        created["products"].append(prod["id"])
        promo = admin.post(f"{API}/promotions", json={
            "name": "TEST_Cond3", "active": True, "weekdays": [wd],
            "condition_items": [{"product_id": prod["id"], "min_qty": 3}],
            "result_type": "discount_percent", "result_value": 50.0,
            "auto_apply": True, "stackable": False}, timeout=30).json()
        created["promotions"].append(promo["id"])
        o = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 20.0, "count": 1}])
        cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash"}, timeout=30)
        order = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert not [a for a in (order.get("applied_promotions") or []) if a["promotion_id"] == promo["id"]]
        assert order["total"] == round(20.0 - (order.get("promo_discount") or 0), 2)

        o2 = _make_order(cashier, [{"product_id": prod["id"], "name": prod["name"], "price": 20.0, "count": 3}])
        cashier.post(f"{API}/orders/{o2['id']}/pay", json={"payment_method": "cash"}, timeout=30)
        order2 = cashier.get(f"{API}/orders/{o2['id']}", timeout=30).json()
        mine = [a for a in (order2.get("applied_promotions") or []) if a["promotion_id"] == promo["id"]]
        assert mine, order2.get("applied_promotions")
        assert mine[0]["discount_amount"] == 30.0
        admin.delete(f"{API}/promotions/{promo['id']}", timeout=30)
        created["promotions"].remove(promo["id"])


# ---------- Task 7: gross/net ----------
class TestGrossNet:
    def test_inventory_processing_loss_persist(self, admin, created):
        loss = {"cold": 5, "boil": 10, "fry": 20, "stew": 8, "bake": 12}
        r = admin.post(f"{API}/inventory", json={"name": "TEST_Картофель", "measure": "kg",
                                                 "balance": 10, "cost": 1.0,
                                                 "processing_loss": loss}, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()
        created["inventory"].append(inv["id"])
        assert inv["processing_loss"] == loss
        got = [x for x in admin.get(f"{API}/inventory", timeout=30).json() if x["id"] == inv["id"]][0]
        assert got["processing_loss"] == loss

        loss2 = {**loss, "fry": 35}
        u = admin.put(f"{API}/inventory/{inv['id']}", json={"name": "TEST_Картофель", "measure": "kg",
                                                            "balance": 10, "cost": 1.0,
                                                            "processing_loss": loss2}, timeout=30)
        assert u.status_code == 200, u.text
        got = [x for x in admin.get(f"{API}/inventory", timeout=30).json() if x["id"] == inv["id"]][0]
        assert got["processing_loss"]["fry"] == 35

    def test_product_yield_autocompute(self, admin, created):
        inv = admin.post(f"{API}/inventory", json={"name": "TEST_Мясо", "measure": "kg", "balance": 10,
                                                   "cost": 10.0,
                                                   "processing_loss": {"cold": 10, "fry": 25}}, timeout=30).json()
        created["inventory"].append(inv["id"])
        recipe = [{"inventory_id": inv["id"], "name": "TEST_Мясо", "amount": 200,
                   "unit": "g", "processing_method": "fry"}]
        p = admin.post(f"{API}/products", json={"name": "TEST_Стейк", "price": 30.0,
                                                "cost_source": "auto", "recipe": recipe}, timeout=30)
        assert p.status_code == 200, p.text
        prod = p.json()
        created["products"].append(prod["id"])
        assert prod["yield_g"] == 150.0, prod["yield_g"]  # 200g * (1-25%)
        # cost stays gross-based: 200 g of 10.0/kg = 2.0
        assert prod["cost"] == 2.0, prod["cost"]

        # manual override respected
        u = admin.put(f"{API}/products/{prod['id']}", json={"name": "TEST_Стейк", "price": 30.0,
                                                            "cost_source": "auto", "recipe": recipe,
                                                            "yield_g": 999.0,
                                                            "preparation_notes": "TEST_Обжарить 3 мин"}, timeout=30)
        assert u.status_code == 200, u.text
        got = [x for x in admin.get(f"{API}/products", timeout=30).json() if x["id"] == prod["id"]][0]
        assert got["yield_g"] == 999.0
        assert got["preparation_notes"] == "TEST_Обжарить 3 мин"
        assert got["recipe"][0]["processing_method"] == "fry"

        # recompute when yield omitted, method changed to cold(10%)
        recipe2 = [{"inventory_id": inv["id"], "name": "TEST_Мясо", "amount": 200,
                    "unit": "g", "processing_method": "cold"}]
        admin.put(f"{API}/products/{prod['id']}", json={"name": "TEST_Стейк", "price": 30.0,
                                                        "cost_source": "auto", "recipe": recipe2}, timeout=30)
        got = [x for x in admin.get(f"{API}/products", timeout=30).json() if x["id"] == prod["id"]][0]
        assert got["yield_g"] == 180.0, got["yield_g"]

    def test_yield_no_method_equals_gross(self, admin, created):
        inv = admin.post(f"{API}/inventory", json={"name": "TEST_Рис", "measure": "kg", "balance": 5,
                                                   "cost": 2.0,
                                                   "processing_loss": {"boil": 50}}, timeout=30).json()
        created["inventory"].append(inv["id"])
        p = admin.post(f"{API}/products", json={
            "name": "TEST_Рисблюдо", "price": 5.0, "cost_source": "auto",
            "recipe": [{"inventory_id": inv["id"], "name": "TEST_Рис", "amount": 0.1, "unit": "kg"}]},
            timeout=30).json()
        created["products"].append(p["id"])
        assert p["yield_g"] == 100.0, p["yield_g"]


# ---------- Task 8: reports ----------
class TestReports:
    def test_by_hall(self, admin):
        r = admin.get(f"{API}/reports/by-hall", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "total" in data
        for row in data["rows"]:
            assert set(["hall", "order_count", "revenue"]).issubset(row.keys())
            assert isinstance(row["order_count"], int)
        assert round(sum(x["revenue"] for x in data["rows"]), 2) == data["total"]

    def test_promotions_report(self, admin):
        r = admin.get(f"{API}/reports/promotions", timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()["rows"]
        for row in rows:
            for k in ("name", "times_applied", "discount_value", "revenue", "roi"):
                assert k in row

    def test_loyalty_report(self, admin):
        r = admin.get(f"{API}/reports/loyalty", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total_accrued", "total_redeemed", "outstanding_balance"):
            assert k in d and isinstance(d[k], (int, float))
        assert d["total_accrued"] >= 0 and d["total_redeemed"] >= 0

    def test_reports_manager_only(self, cashier, waiter):
        for s in (cashier, waiter):
            for p in ("by-hall", "promotions", "loyalty"):
                assert s.get(f"{API}/reports/{p}", timeout=30).status_code == 403, p

    def test_reports_unauthenticated(self):
        for p in ("by-hall", "promotions", "loyalty"):
            assert requests.get(f"{API}/reports/{p}", timeout=30).status_code in (401, 403)


# ---------- Switcher ----------
class TestSwitcher:
    def test_switch_returns_scoped_token(self, admin):
        rests = admin.get(f"{API}/restaurants", timeout=30).json()
        assert rests
        rid = rests[0]["id"]
        r = admin.post(f"{API}/restaurants/switch/{rid}", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["restaurant_id"] == rid and d["restaurant_name"] == rests[0]["name"]
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {d['token']}"})
        me = s.get(f"{API}/auth/me", timeout=30)
        assert me.status_code == 200
        cur = s.get(f"{API}/restaurants/current", timeout=30).json()
        assert cur["id"] == rid

    def test_switch_unknown_404(self, admin):
        assert admin.post(f"{API}/restaurants/switch/507f1f77bcf86cd799439011",
                          timeout=30).status_code == 404

    def test_switch_manager_only(self, cashier):
        rests = cashier.get(f"{API}/restaurants", timeout=30).json()
        rid = rests[0]["id"]
        assert cashier.post(f"{API}/restaurants/switch/{rid}", timeout=30).status_code == 403
