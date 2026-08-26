"""Iteration 2 — recipes auto write-off, split/move order, shift-close guard, RBAC."""
import pytest

from conftest import API


@pytest.fixture(scope="module")
def shift(cashier):
    r = cashier.post(f"{API}/shifts/open", json={}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="module")
def catalog(admin):
    return {"products": admin.get(f"{API}/products", timeout=30).json(),
            "tables": admin.get(f"{API}/tables", timeout=30).json()}


def _inv(admin):
    return {i["name"]: i for i in admin.get(f"{API}/inventory", timeout=30).json()}


def _mk_order(sess, catalog, names, table_index=0):
    prods = {p["name"]: p for p in catalog["products"]}
    items = [{"product_id": prods[n]["id"], "name": n, "price": prods[n]["price"],
              "count": 1, "workshop_id": prods[n].get("workshop_id")} for n in names]
    r = sess.post(f"{API}/orders",
                  json={"table_id": catalog["tables"][table_index]["id"], "items": items}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


# ---------- Feature 1: recipes / auto write-off ----------
class TestRecipeAutoWriteoff:
    def test_seeded_recipes_exist(self, admin, catalog):
        prods = {p["name"]: p for p in catalog["products"]}
        burger = prods["Классический бургер"]
        assert burger.get("recipe"), "Классический бургер must have a тех.карта"
        names = {i["name"]: i["amount"] for i in burger["recipe"]}
        assert names.get("Булочки") == 1
        # iteration-6: recipe unit switched to grams -> 150 g == 0.15 kg
        assert names.get("Говядина") in (0.15, 150), names

    def test_pay_order_deducts_recipe_ingredients_and_logs_writeoff(self, admin, cashier, shift, catalog):
        before = _inv(admin)
        bun0 = before["Булочки"]["balance"]
        beef0 = before["Говядина"]["balance"]

        o = _mk_order(cashier, catalog, ["Классический бургер"])
        r = cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "closed"

        after = _inv(admin)
        assert round(after["Булочки"]["balance"], 3) == round(bun0 - 1, 3), \
            f"Булочки {bun0} -> {after['Булочки']['balance']}"
        assert round(after["Говядина"]["balance"], 3) == round(beef0 - 0.15, 3), \
            f"Говядина {beef0} -> {after['Говядина']['balance']}"

        wos = admin.get(f"{API}/writeoffs", timeout=30).json()
        sale = [w for w in wos if w.get("reason") == "Продажа: Классический бургер"]
        assert sale, "expected a 'Продажа: <dish>' write-off record"
        assert {w["name"] for w in sale[:2]} <= {"Булочки", "Говядина"}

    def test_writeoff_scales_with_count(self, admin, cashier, shift, catalog):
        before = _inv(admin)["Булочки"]["balance"]
        prods = {p["name"]: p for p in catalog["products"]}
        p = prods["Классический бургер"]
        r = cashier.post(f"{API}/orders", json={"table_id": catalog["tables"][1]["id"], "items": [
            {"product_id": p["id"], "name": p["name"], "price": p["price"], "count": 3,
             "workshop_id": p["workshop_id"]}]}, timeout=30)
        assert r.status_code == 200
        oid = r.json()["id"]
        assert cashier.post(f"{API}/orders/{oid}/pay", json={"payment_method": "card"}, timeout=30).status_code == 200
        after = _inv(admin)["Булочки"]["balance"]
        assert round(after, 3) == round(before - 3, 3), f"{before} -> {after} for count=3"

    def test_product_without_recipe_does_not_writeoff(self, admin, cashier, shift, catalog):
        wos_before = len(admin.get(f"{API}/writeoffs", timeout=30).json())
        o = _mk_order(cashier, catalog, ["Кола 0.5л"], table_index=2)
        assert cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash"}, timeout=30).status_code == 200
        wos_after = len(admin.get(f"{API}/writeoffs", timeout=30).json())
        assert wos_after == wos_before

    def test_recipe_editable_via_product_update(self, admin, catalog):
        inv = _inv(admin)
        r = admin.post(f"{API}/products", json={"name": "TEST_Блюдо", "price": 5.0,
                                                "recipe": [{"inventory_id": inv["Сыр"]["id"],
                                                            "name": "Сыр", "amount": 0.02}]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        pid = r.json()["id"]
        assert r.json()["recipe"][0]["amount"] == 0.02
        upd = admin.put(f"{API}/products/{pid}", json={"name": "TEST_Блюдо", "price": 5.0,
                                                       "recipe": [{"inventory_id": inv["Сыр"]["id"],
                                                                   "name": "Сыр", "amount": 0.05}]}, timeout=30)
        assert upd.status_code == 200
        got = next(p for p in admin.get(f"{API}/products", timeout=30).json() if p["id"] == pid)
        assert got["recipe"][0]["amount"] == 0.05
        admin.delete(f"{API}/products/{pid}", timeout=30)


# ---------- Feature 3: split & move ----------
class TestSplitAndMove:
    def test_move_order_to_another_table(self, cashier, shift, catalog):
        t_from, t_to = catalog["tables"][3]["id"], catalog["tables"][4]["id"]
        o = _mk_order(cashier, catalog, ["Цезарь"], table_index=3)
        assert o["table_id"] == t_from
        r = cashier.post(f"{API}/orders/{o['id']}/move", json={"table_id": t_to}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["table_id"] == t_to
        got = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert got["table_id"] == t_to
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_split_creates_second_bill(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Цезарь", "Кола 0.5л", "Латте"], table_index=5)
        prods = {p["name"]: p for p in catalog["products"]}
        names = [i["name"] for i in o["items"]]
        r = cashier.post(f"{API}/orders/{o['id']}/split",
                         json={"indices": [names.index("Кола 0.5л")]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert [i["name"] for i in d["split"]["items"]] == ["Кола 0.5л"]
        assert d["split"]["subtotal"] == prods["Кола 0.5л"]["price"]
        assert d["split"]["status"] == "open"
        assert d["split"]["table_id"] == o["table_id"]
        rem_names = {i["name"] for i in d["original"]["items"]}
        assert rem_names == {"Цезарь", "Латте"}
        assert round(d["original"]["subtotal"] + d["split"]["subtotal"], 2) == round(o["subtotal"], 2)
        # pay the split, remaining stays open
        assert cashier.post(f"{API}/orders/{d['split']['id']}/pay",
                            json={"payment_method": "cash"}, timeout=30).status_code == 200
        rem = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert rem["status"] == "open"
        assert cashier.post(f"{API}/orders/{o['id']}/pay",
                            json={"payment_method": "cash"}, timeout=30).status_code == 200

    def test_split_all_items_rejected(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Цезарь"], table_index=6)
        prods = {p["name"]: p for p in catalog["products"]}
        r = cashier.post(f"{API}/orders/{o['id']}/split", json={"indices": [0]}, timeout=30)
        assert r.status_code == 400
        r2 = cashier.post(f"{API}/orders/{o['id']}/split", json={"indices": []}, timeout=30)
        assert r2.status_code == 400
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_move_and_split_bad_order_id(self, cashier):
        assert cashier.post(f"{API}/orders/zzz/move", json={"table_id": None}, timeout=30).status_code == 404
        assert cashier.post(f"{API}/orders/zzz/split", json={"indices": []}, timeout=30).status_code == 404


# ---------- Feature 4: shift close guard + RBAC ----------
class TestShiftGuardAndRbac:
    def test_close_shift_blocked_by_open_order(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Кола 0.5л"], table_index=7)
        r = cashier.post(f"{API}/shifts/close", json={}, timeout=30)
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text[:200]}"
        assert "незакрыт" in r.json()["detail"].lower()
        # sent order also blocks
        cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30)
        r = cashier.post(f"{API}/shifts/close", json={}, timeout=30)
        assert r.status_code == 400
        # pay it, then close works
        assert cashier.post(f"{API}/orders/{o['id']}/pay",
                            json={"payment_method": "cash"}, timeout=30).status_code == 200
        leftovers = [x for x in cashier.get(f"{API}/orders", timeout=30).json()
                     if x["status"] in ("open", "sent")]
        for x in leftovers:
            cashier.delete(f"{API}/orders/{x['id']}", timeout=30)
        r = cashier.post(f"{API}/shifts/close", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "closed"
        # reopen for other tests / UI
        cashier.post(f"{API}/shifts/open", json={}, timeout=30)

    def test_waiter_cannot_pay(self, waiter, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Кола 0.5л"], table_index=7)
        r = waiter.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash"}, timeout=30)
        assert r.status_code == 403
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)
