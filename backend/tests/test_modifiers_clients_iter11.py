"""Iteration 11 — Task 3 (Модификаторы) & Task 4 (Клиенты и скидки)."""
import uuid

import pytest
import requests

from conftest import API


def _ensure_shift(cashier):
    r = cashier.get(f"{API}/shifts/current", timeout=30)
    if r.status_code == 200 and r.json():
        return
    cashier.post(f"{API}/shifts/open", json={"opening_cash": 1000}, timeout=30)


# --------------------------------------------------------------- MODIFIER CRUD
class TestModifierGroupCRUD:
    @pytest.fixture(scope="class")
    def created(self):
        return {"groups": [], "products": []}

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, admin, created):
        yield
        for gid in created["groups"]:
            admin.delete(f"{API}/modifier-groups/{gid}", timeout=30)
        for pid in created["products"]:
            admin.delete(f"{API}/products/{pid}", timeout=30)

    def test_list_groups_have_options_array(self, admin):
        r = admin.get(f"{API}/modifier-groups", timeout=30)
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list) and len(groups) >= 1
        for g in groups:
            assert "id" in g and "_id" not in g
            assert isinstance(g["options"], list)
            for o in g["options"]:
                assert "_id" not in o
                assert o["group_id"] == g["id"]

    def test_seeded_dobavki_group(self, admin):
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        g = next((x for x in groups if x["name"] == "Добавки"), None)
        assert g, "seeded group 'Добавки' missing"
        assert g["selection_type"] == "multiple"
        assert g["min_count"] == 0 and g["max_count"] == 3
        names = {o["name"]: o for o in g["options"]}
        assert "Доп. сыр" in names and names["Доп. сыр"]["price_delta"] == 1.5
        assert names["Доп. сыр"].get("inventory_id") and names["Доп. сыр"].get("amount") == 0.02
        assert names["Бекон"]["price_delta"] == 2.0
        assert names["Без лука"]["price_delta"] == 0

    def test_create_update_delete_group_and_options(self, admin, created):
        payload = {"name": f"TEST_grp_{uuid.uuid4().hex[:6]}", "selection_type": "single",
                   "min_count": 1, "max_count": 1}
        r = admin.post(f"{API}/modifier-groups", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        g = r.json()
        gid = g["id"]
        created["groups"].append(gid)
        assert g["name"] == payload["name"] and g["min_count"] == 1

        # option create
        ro = admin.post(f"{API}/modifier-groups/{gid}/options",
                        json={"name": "TEST_opt", "price_delta": 3.25}, timeout=30)
        assert ro.status_code == 200, ro.text
        opt = ro.json()
        assert opt["group_id"] == gid and opt["price_delta"] == 3.25

        # GET verify persistence
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        gg = next(x for x in groups if x["id"] == gid)
        assert len(gg["options"]) == 1 and gg["options"][0]["name"] == "TEST_opt"

        # update group
        ru = admin.put(f"{API}/modifier-groups/{gid}",
                       json={**payload, "name": payload["name"] + "_upd", "max_count": 2}, timeout=30)
        assert ru.status_code == 200
        assert ru.json()["name"] == payload["name"] + "_upd"
        assert ru.json()["max_count"] == 2

        # update option
        ruo = admin.put(f"{API}/modifier-groups/{gid}/options/{opt['id']}",
                        json={"name": "TEST_opt2", "price_delta": 4.0}, timeout=30)
        assert ruo.status_code == 200 and ruo.json()["name"] == "TEST_opt2"
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        gg = next(x for x in groups if x["id"] == gid)
        assert gg["options"][0]["price_delta"] == 4.0

        # delete option
        rd = admin.delete(f"{API}/modifier-groups/{gid}/options/{opt['id']}", timeout=30)
        assert rd.status_code == 200
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        gg = next(x for x in groups if x["id"] == gid)
        assert gg["options"] == []

    def test_option_on_unknown_group_404(self, admin):
        r = admin.post(f"{API}/modifier-groups/ffffffffffffffffffffffff/options",
                       json={"name": "TEST_x"}, timeout=30)
        assert r.status_code == 404

    def test_delete_group_cascades_options_and_unlinks_products(self, admin, created):
        r = admin.post(f"{API}/modifier-groups",
                       json={"name": f"TEST_casc_{uuid.uuid4().hex[:6]}"}, timeout=30)
        gid = r.json()["id"]
        admin.post(f"{API}/modifier-groups/{gid}/options",
                   json={"name": "TEST_casc_opt", "price_delta": 1}, timeout=30)
        # product linked to the group
        rp = admin.post(f"{API}/products", json={"name": f"TEST_prod_{uuid.uuid4().hex[:6]}",
                                                 "price": 10, "modifier_group_ids": [gid]}, timeout=30)
        assert rp.status_code == 200, rp.text
        pid = rp.json()["id"]
        created["products"].append(pid)
        assert rp.json()["modifier_group_ids"] == [gid]

        assert admin.delete(f"{API}/modifier-groups/{gid}", timeout=30).status_code == 200

        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        assert gid not in [x["id"] for x in groups]
        # options gone (no other group claims them)
        assert all(o["name"] != "TEST_casc_opt" for g in groups for o in g["options"])
        # unlinked from product
        prod = next(p for p in admin.get(f"{API}/products", timeout=30).json() if p["id"] == pid)
        assert prod["modifier_group_ids"] == []

    def test_modifier_crud_manager_only(self, cashier, waiter, admin):
        gid = admin.get(f"{API}/modifier-groups", timeout=30).json()[0]["id"]
        for sess in (cashier, waiter):
            assert sess.post(f"{API}/modifier-groups", json={"name": "TEST_nope"}, timeout=30).status_code == 403
            assert sess.put(f"{API}/modifier-groups/{gid}", json={"name": "TEST_nope"}, timeout=30).status_code == 403
            assert sess.delete(f"{API}/modifier-groups/{gid}", timeout=30).status_code == 403
            assert sess.post(f"{API}/modifier-groups/{gid}/options", json={"name": "x"}, timeout=30).status_code == 403
            assert sess.put(f"{API}/modifier-groups/{gid}/options/{gid}", json={"name": "x"}, timeout=30).status_code == 403
            assert sess.delete(f"{API}/modifier-groups/{gid}/options/{gid}", timeout=30).status_code == 403
        # read allowed for PIN roles
        assert cashier.get(f"{API}/modifier-groups", timeout=30).status_code == 200


# ------------------------------------------------ PRODUCT ASSOCIATION
class TestProductModifierAssociation:
    def test_put_product_persists_modifier_group_ids(self, admin):
        gid = admin.get(f"{API}/modifier-groups", timeout=30).json()[0]["id"]
        rp = admin.post(f"{API}/products", json={"name": f"TEST_assoc_{uuid.uuid4().hex[:6]}",
                                                 "price": 5}, timeout=30)
        pid = rp.json()["id"]
        try:
            assert rp.json()["modifier_group_ids"] == []
            base = rp.json()
            body = {"name": base["name"], "price": 5, "modifier_group_ids": [gid]}
            ru = admin.put(f"{API}/products/{pid}", json=body, timeout=30)
            assert ru.status_code == 200, ru.text
            assert ru.json()["modifier_group_ids"] == [gid]
            prod = next(p for p in admin.get(f"{API}/products", timeout=30).json() if p["id"] == pid)
            assert prod["modifier_group_ids"] == [gid]
        finally:
            admin.delete(f"{API}/products/{pid}", timeout=30)


# ------------------------------------------------ ORDER PRICING WITH MODIFIERS
class TestOrderModifierPricing:
    @pytest.fixture(scope="class")
    def burger(self, admin):
        prods = admin.get(f"{API}/products", timeout=30).json()
        p = next((x for x in prods if x["name"] == "Классический бургер"), None)
        assert p, "demo product Классический бургер missing"
        assert p["modifier_group_ids"], "burger has no modifier groups attached"
        return p

    @pytest.fixture(scope="class")
    def cheese_opt(self, admin):
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        for g in groups:
            for o in g["options"]:
                if o["name"] == "Доп. сыр":
                    return g, o
        pytest.fail("Доп. сыр option missing")

    def test_create_order_with_modifier_pricing(self, waiter, cashier, burger, cheese_opt):
        _ensure_shift(cashier)
        g, o = cheese_opt
        item = {"product_id": burger["id"], "name": burger["name"], "price": burger["price"],
                "count": 1, "workshop_id": burger.get("workshop_id"),
                "selected_modifiers": [{"group_id": g["id"], "option_id": o["id"],
                                        "name": o["name"], "price_delta": o["price_delta"]}]}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        assert r.status_code == 200, r.text
        order = r.json()
        oid = order["id"]
        try:
            expected = round(burger["price"] + o["price_delta"], 2)
            assert order["items"][0]["total"] == expected
            assert order["subtotal"] == expected
            assert order["items"][0]["selected_modifiers"][0]["name"] == "Доп. сыр"

            # update: count 2 + second modifier
            item2 = dict(item)
            item2["count"] = 2
            r2 = waiter.put(f"{API}/orders/{oid}", json={"items": [item2]}, timeout=30)
            assert r2.status_code == 200
            assert r2.json()["subtotal"] == round((burger["price"] + o["price_delta"]) * 2, 2)

            # GET verifies persistence
            g2 = waiter.get(f"{API}/orders/{oid}", timeout=30).json()
            assert g2["subtotal"] == round((burger["price"] + o["price_delta"]) * 2, 2)
        finally:
            waiter.delete(f"{API}/orders/{oid}", timeout=30)

    def test_client_supplied_totals_ignored(self, waiter, cashier, burger, cheese_opt):
        """Backend must be authoritative — a forged 'total' is recomputed."""
        _ensure_shift(cashier)
        g, o = cheese_opt
        item = {"product_id": burger["id"], "name": burger["name"], "price": burger["price"],
                "count": 1, "total": 0.01,
                "selected_modifiers": [{"group_id": g["id"], "option_id": o["id"],
                                        "name": o["name"], "price_delta": o["price_delta"]}]}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        oid = r.json()["id"]
        try:
            assert r.json()["subtotal"] == round(burger["price"] + o["price_delta"], 2)
        finally:
            waiter.delete(f"{API}/orders/{oid}", timeout=30)

    def test_kitchen_ticket_includes_modifiers(self, waiter, cashier, burger, cheese_opt):
        _ensure_shift(cashier)
        g, o = cheese_opt
        item = {"product_id": burger["id"], "name": burger["name"], "price": burger["price"],
                "count": 1, "workshop_id": burger.get("workshop_id"),
                "selected_modifiers": [{"group_id": g["id"], "option_id": o["id"],
                                        "name": o["name"], "price_delta": o["price_delta"]}]}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        oid = r.json()["id"]
        try:
            rs = waiter.post(f"{API}/orders/{oid}/send", json={}, timeout=30)
            assert rs.status_code == 200, rs.text
            jobs = rs.json().get("jobs", [])
            assert jobs, "no print job created for the kitchen workshop"
            text = "\n".join(jobs[0].get("lines") or []) or jobs[0].get("text", "")
            assert "Доп. сыр" in text, f"modifier missing from ticket: {text}"
            assert "+ Доп. сыр" in text
            # precheck also shows modifier
            rp = waiter.post(f"{API}/orders/{oid}/precheck", json={}, timeout=30)
            if rp.status_code == 200:
                j = rp.json()
                txt = str(j)
                assert "Доп. сыр" in txt
        finally:
            waiter.delete(f"{API}/orders/{oid}", timeout=30)


# ------------------------------------------------ MODIFIER WRITE-OFF ON PAY
class TestModifierWriteOff:
    def test_pay_writes_off_modifier_ingredient(self, admin, waiter, cashier):
        _ensure_shift(cashier)
        groups = admin.get(f"{API}/modifier-groups", timeout=30).json()
        opt = None
        grp = None
        for g in groups:
            for o in g["options"]:
                if o.get("inventory_id") and o.get("amount"):
                    grp, opt = g, o
                    break
        assert opt, "no modifier option with inventory linkage"
        burger = next(p for p in admin.get(f"{API}/products", timeout=30).json()
                      if p["name"] == "Классический бургер")
        inv_before = next(i for i in admin.get(f"{API}/inventory", timeout=30).json()
                          if i["id"] == opt["inventory_id"])
        wh_id = next((s["warehouse_id"] for s in inv_before.get("stocks", [])), None)
        before_by_wh = {s["warehouse_id"]: s["quantity"] for s in inv_before.get("stocks", [])}

        item = {"product_id": burger["id"], "name": burger["name"], "price": burger["price"],
                "count": 1, "workshop_id": burger.get("workshop_id"),
                "selected_modifiers": [{"group_id": grp["id"], "option_id": opt["id"],
                                        "name": opt["name"], "price_delta": opt["price_delta"]}]}
        oid = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30).json()["id"]
        rp = cashier.post(f"{API}/orders/{oid}/pay", json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert rp.status_code == 200, rp.text
        assert rp.json()["status"] == "closed"

        wos = admin.get(f"{API}/writeoffs", timeout=30).json()
        mod_wos = [w for w in wos if "(модификатор)" in (w.get("name") or "")]
        assert mod_wos, "no modifier write-off logged"
        latest = mod_wos[0]
        assert latest["kind"] == "sale"
        assert latest["inventory_id"] == opt["inventory_id"]
        assert abs(latest["amount"] - opt["amount"]) < 1e-6
        assert latest.get("warehouse_id")

        inv_after = next(i for i in admin.get(f"{API}/inventory", timeout=30).json()
                         if i["id"] == opt["inventory_id"])
        after_by_wh = {s["warehouse_id"]: s["quantity"] for s in inv_after.get("stocks", [])}
        wid = latest["warehouse_id"]
        # the modifier amount plus (possibly) recipe usage of the same ingredient must decrement
        assert after_by_wh.get(wid, 0) <= before_by_wh.get(wid, 0) - opt["amount"] + 1e-6, \
            f"stock not decremented: before={before_by_wh}, after={after_by_wh}"
        assert wh_id is not None


# ------------------------------------------------------------------ CLIENTS
class TestClientCRUD:
    @pytest.fixture(scope="class")
    def created(self):
        return []

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, admin, created):
        yield
        for cid in created:
            admin.delete(f"{API}/clients/{cid}", timeout=30)

    def test_seeded_client(self, admin):
        r = admin.get(f"{API}/clients", timeout=30)
        assert r.status_code == 200
        clients = r.json()
        c = next((x for x in clients if x["name"] == "Иван Петров"), None)
        assert c, "demo client missing"
        assert c["discount_percent"] == 10
        assert c["phone_digits"] == "79001234567"
        assert "_id" not in c

    def test_create_duplicate_and_lookup(self, admin, created):
        phone = "+7 900 000-11-22"
        payload = {"name": "TEST_Клиент", "phone": phone, "discount_percent": 15}
        r = admin.post(f"{API}/clients", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        created.append(c["id"])
        assert c["name"] == payload["name"] and c["discount_percent"] == 15
        assert c["phone_digits"] == "79000001122"

        # duplicate (different formatting, same digits) -> 400
        dup = admin.post(f"{API}/clients", json={"name": "TEST_Dup", "phone": "79000001122"}, timeout=30)
        assert dup.status_code == 400, dup.text
        assert "уже существует" in dup.json()["detail"]

        # format-insensitive lookup
        for q in ("79000001122", "+7 (900) 000-11-22", "7 900 000 11 22"):
            rl = admin.get(f"{API}/clients", params={"phone": q}, timeout=30)
            assert rl.status_code == 200, f"{q} -> {rl.status_code}"
            assert rl.json()["id"] == c["id"]

        # unknown phone -> 404
        assert admin.get(f"{API}/clients", params={"phone": "70000000000"}, timeout=30).status_code == 404

    def test_update_client(self, admin, created):
        r = admin.post(f"{API}/clients", json={"name": "TEST_Upd", "phone": "+7 900 000-33-44"}, timeout=30)
        cid = r.json()["id"]
        created.append(cid)
        ru = admin.put(f"{API}/clients/{cid}",
                       json={"name": "TEST_Upd2", "phone": "+7 900 000-33-44", "discount_percent": 7}, timeout=30)
        assert ru.status_code == 200, ru.text
        assert ru.json()["name"] == "TEST_Upd2" and ru.json()["discount_percent"] == 7
        # GET verify persisted
        lst = admin.get(f"{API}/clients", timeout=30).json()
        got = next(x for x in lst if x["id"] == cid)
        assert got["name"] == "TEST_Upd2" and got["discount_percent"] == 7
        # updating to another client's phone -> 400
        rd = admin.put(f"{API}/clients/{cid}",
                       json={"name": "TEST_Upd2", "phone": "+7 900 123-45-67"}, timeout=30)
        assert rd.status_code == 400

    def test_delete_client_manager_only(self, admin, cashier, waiter):
        r = admin.post(f"{API}/clients", json={"name": "TEST_Del", "phone": "+7 900 000-55-66"}, timeout=30)
        cid = r.json()["id"]
        assert cashier.delete(f"{API}/clients/{cid}", timeout=30).status_code == 403
        assert waiter.delete(f"{API}/clients/{cid}", timeout=30).status_code == 403
        assert admin.delete(f"{API}/clients/{cid}", timeout=30).status_code == 200
        lst = admin.get(f"{API}/clients", timeout=30).json()
        assert cid not in [x["id"] for x in lst]

    def test_waiter_can_read_and_create(self, waiter, admin):
        assert waiter.get(f"{API}/clients", timeout=30).status_code == 200
        r = waiter.post(f"{API}/clients", json={"name": "TEST_ByWaiter", "phone": "+7 900 000-77-88"}, timeout=30)
        assert r.status_code == 200, r.text
        admin.delete(f"{API}/clients/{r.json()['id']}", timeout=30)


# ------------------------------------------------ PAY WITH CLIENT DISCOUNT
class TestPayWithClientDiscount:
    def test_pay_with_client_discount(self, admin, waiter, cashier):
        _ensure_shift(cashier)
        client = next(c for c in admin.get(f"{API}/clients", timeout=30).json()
                      if c["name"] == "Иван Петров")
        prod = next(p for p in admin.get(f"{API}/products", timeout=30).json()
                    if p["name"] == "Классический бургер")
        item = {"product_id": prod["id"], "name": prod["name"], "price": prod["price"], "count": 1}
        oid = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30).json()["id"]
        subtotal = prod["price"]
        discount = round(subtotal * client["discount_percent"] / 100, 2)
        rp = cashier.post(f"{API}/orders/{oid}/pay",
                          json={"payment_method": "card", "discount": discount,
                                "client_id": client["id"]}, timeout=30)
        assert rp.status_code == 200, rp.text
        o = rp.json()
        assert o["discount"] == discount
        assert o["total"] == round(subtotal - discount, 2)
        assert o["discount_percent"] == round(discount / subtotal * 100, 2)
        assert o["client_id"] == client["id"]
        assert o["client_name"] == "Иван Петров"
        assert o["discount_source"] == f"client:{client['name']}"
        # persisted
        g = admin.get(f"{API}/orders/{oid}", timeout=30).json()
        assert g["discount_source"] == f"client:{client['name']}"
        assert g["client_name"] == "Иван Петров"

    def test_manual_discount_source(self, admin, waiter, cashier):
        _ensure_shift(cashier)
        prod = next(p for p in admin.get(f"{API}/products", timeout=30).json()
                    if p["name"] == "Классический бургер")
        item = {"product_id": prod["id"], "name": prod["name"], "price": prod["price"], "count": 1}
        oid = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30).json()["id"]
        rp = cashier.post(f"{API}/orders/{oid}/pay",
                          json={"payment_method": "cash", "discount": 1.0}, timeout=30)
        assert rp.status_code == 200
        assert rp.json()["discount_source"] == "manual"
        assert rp.json()["client_id"] in (None, "")

    def test_order_client_id_used_when_pay_omits_it(self, admin, waiter, cashier):
        _ensure_shift(cashier)
        client = next(c for c in admin.get(f"{API}/clients", timeout=30).json()
                      if c["name"] == "Иван Петров")
        prod = next(p for p in admin.get(f"{API}/products", timeout=30).json()
                    if p["name"] == "Классический бургер")
        item = {"product_id": prod["id"], "name": prod["name"], "price": prod["price"], "count": 1}
        r = waiter.post(f"{API}/orders", json={"items": [item], "client_id": client["id"]}, timeout=30)
        assert r.json()["client_id"] == client["id"]
        oid = r.json()["id"]
        rp = cashier.post(f"{API}/orders/{oid}/pay", json={"payment_method": "cash"}, timeout=30)
        assert rp.status_code == 200
        assert rp.json()["client_name"] == "Иван Петров"


# ------------------------------------------------------------- SALES REPORT
class TestSalesReportByClient:
    def test_group_by_client(self, admin):
        r = admin.get(f"{API}/reports/sales", params={"group_by": "client"}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["rows", "total_revenue", "total_discount"]).issubset(data.keys())
        assert isinstance(data["rows"], list) and data["rows"], "no client rows (paid client orders exist)"
        for row in data["rows"]:
            assert set(["client_id", "client_name", "order_count",
                        "total_revenue", "total_discount"]).issubset(row.keys())
            assert isinstance(row["order_count"], int) and row["order_count"] >= 1
        assert abs(data["total_revenue"] - round(sum(x["total_revenue"] for x in data["rows"]), 2)) < 0.01
        ivan = next((x for x in data["rows"] if x["client_name"] == "Иван Петров"), None)
        assert ivan, "Иван Петров missing from client sales report"
        assert ivan["total_discount"] > 0

    def test_standard_sales_report_unchanged(self, admin):
        r = admin.get(f"{API}/reports/sales", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "cash", "card", "by_product", "by_cashier"):
            assert k in d, f"missing {k}"
        assert isinstance(d["by_product"], list)

    def test_sales_report_manager_only(self, cashier):
        r = cashier.get(f"{API}/reports/sales", params={"group_by": "client"}, timeout=30)
        assert r.status_code == 403


# --------------------------------------------------------------- AUTH SANITY
class TestAuthSanity:
    def test_unauthenticated_blocked(self):
        for path in ("/modifier-groups", "/clients"):
            r = requests.get(f"{API}{path}", timeout=30)
            assert r.status_code in (401, 403), f"{path} -> {r.status_code}"
