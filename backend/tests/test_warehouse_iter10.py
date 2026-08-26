"""Iteration 10 — Task 2: MULTI-WAREHOUSE (мультисклад), auto cost, stock-movement report."""
import datetime as dt

import pytest
import requests

from conftest import API

TS = dt.datetime.utcnow().strftime("%H%M%S")


# ---------- helpers ----------
def get_warehouses(admin):
    r = admin.get(f"{API}/warehouses", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def inv_list(admin):
    r = admin.get(f"{API}/inventory", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def find_item(admin, name):
    for i in inv_list(admin):
        if i["name"] == name:
            return i
    return None


def stock_of(item, wh_id):
    for s in item.get("stocks", []):
        if s["warehouse_id"] == wh_id:
            return s["quantity"]
    return 0.0


@pytest.fixture(scope="module")
def created(admin):
    """Track created ids for cleanup."""
    bag = {"warehouses": [], "inventory": [], "products": []}
    yield bag
    for pid in bag["products"]:
        admin.delete(f"{API}/products/{pid}", timeout=30)
    for iid in bag["inventory"]:
        admin.delete(f"{API}/inventory/{iid}", timeout=30)
    for wid in bag["warehouses"]:
        admin.delete(f"{API}/warehouses/{wid}", timeout=30)


@pytest.fixture(scope="module")
def whs(admin):
    return get_warehouses(admin)


_seq = {"n": 0}


@pytest.fixture
def make_item(admin, created):
    """Factory for a dedicated inventory item (never disturbs demo stock)."""
    def _make(measure="kg", cost=100, balance=0, warehouse_id=None):
        _seq["n"] += 1
        payload = {"name": f"TEST_Ингр_{TS}_{_seq['n']}", "measure": measure,
                   "balance": balance, "cost": cost}
        if warehouse_id:
            payload["warehouse_id"] = warehouse_id
        r = admin.post(f"{API}/inventory", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        created["inventory"].append(iid)
        return iid
    return _make


# ---------- Warehouses seeding & CRUD ----------
class TestWarehouses:
    def test_seeded_warehouses(self, admin, whs):
        names = [w["name"] for w in whs]
        assert "Склад Кухня" in names, names
        assert "Склад Бар" in names, names
        kitchen = next(w for w in whs if w["name"] == "Склад Кухня")
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        assert kitchen["is_default"] is True
        assert kitchen.get("workshop_id"), "kitchen warehouse must map to a workshop"
        assert bar.get("workshop_id"), "bar warehouse must map to a workshop"
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        wsmap = {w["id"]: w["name"] for w in ws}
        assert wsmap.get(kitchen["workshop_id"]) == "Кухня"
        assert wsmap.get(bar["workshop_id"]) == "Бар"
        for w in whs:
            assert "_id" not in w and w.get("restaurant_id")

    def test_crud_warehouse(self, admin, created):
        r = admin.post(f"{API}/warehouses", json={"name": f"TEST_Склад_{TS}"}, timeout=30)
        assert r.status_code == 200, r.text
        w = r.json()
        wid = w["id"]
        created["warehouses"].append(wid)
        assert w["name"] == f"TEST_Склад_{TS}"
        assert w["is_default"] is False
        # persisted
        assert any(x["id"] == wid for x in get_warehouses(admin))
        # update
        ru = admin.put(f"{API}/warehouses/{wid}", json={"name": f"TEST_Склад_упд_{TS}"}, timeout=30)
        assert ru.status_code == 200, ru.text
        assert ru.json()["name"] == f"TEST_Склад_упд_{TS}"
        assert ru.json()["is_default"] is False
        got = next(x for x in get_warehouses(admin) if x["id"] == wid)
        assert got["name"] == f"TEST_Склад_упд_{TS}"
        # delete
        rd = admin.delete(f"{API}/warehouses/{wid}", timeout=30)
        assert rd.status_code == 200, rd.text
        assert not any(x["id"] == wid for x in get_warehouses(admin))
        created["warehouses"].remove(wid)

    def test_cannot_delete_default(self, admin, whs):
        d = next(w for w in whs if w["is_default"])
        r = admin.delete(f"{API}/warehouses/{d['id']}", timeout=30)
        assert r.status_code == 400, r.text
        assert "умолчанию" in r.json().get("detail", "")
        assert any(x["id"] == d["id"] for x in get_warehouses(admin))

    def test_non_manager_cannot_manage(self, cashier):
        r = cashier.post(f"{API}/warehouses", json={"name": "TEST_forbidden"}, timeout=30)
        assert r.status_code == 403, r.text


# ---------- /inventory stocks aggregation ----------
class TestInventoryStocks:
    def test_stocks_and_balance_consistent(self, admin, whs):
        items = inv_list(admin)
        assert items
        wh_ids = {w["id"] for w in whs}
        for it in items:
            assert isinstance(it.get("stocks"), list), it
            s = round(sum(x["quantity"] for x in it["stocks"]), 3)
            assert abs(s - round(it["balance"], 3)) < 0.01, \
                f"{it['name']}: balance={it['balance']} sum(stocks)={s}"
            for x in it["stocks"]:
                assert x["warehouse_id"] in wh_ids
                assert x["warehouse_name"] not in (None, "", "—")
            assert "_id" not in it

    def test_initial_balance_lands_on_chosen_warehouse(self, admin, whs, created):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        r = admin.post(f"{API}/inventory", json={
            "name": f"TEST_БарТовар_{TS}", "measure": "l", "balance": 7, "cost": 50,
            "warehouse_id": bar["id"]}, timeout=30)
        assert r.status_code == 200, r.text
        iid = r.json()["id"]
        created["inventory"].append(iid)
        it = next(x for x in inv_list(admin) if x["id"] == iid)
        assert it["balance"] == 7
        assert stock_of(it, bar["id"]) == 7
        assert len(it["stocks"]) == 1


# ---------- Invoices per warehouse ----------
class TestInvoicePerWarehouse:
    def test_invoice_increases_only_target_warehouse(self, admin, whs, make_item):
        iid = make_item()
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        before = next(x for x in inv_list(admin) if x["id"] == iid)
        b_bar, b_kit, b_total = stock_of(before, bar["id"]), stock_of(before, kitchen["id"]), before["balance"]

        num = f"TEST-INV-{TS}-{iid[-5:]}"
        r = admin.post(f"{API}/invoices", json={
            "number": num, "supplier_name": "TEST_Поставщик",
            "warehouse_id": bar["id"],
            "items": [{"inventory_id": iid, "name": "TEST", "amount": 5, "price": 250}]}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["warehouse_id"] == bar["id"]
        assert r.json()["total"] == 1250

        after = next(x for x in inv_list(admin) if x["id"] == iid)
        assert stock_of(after, bar["id"]) == b_bar + 5
        assert stock_of(after, kitchen["id"]) == b_kit
        assert round(after["balance"], 3) == round(b_total + 5, 3)
        assert after["cost"] == 250  # ingredient cost updated from invoice price

        # duplicate number rejected
        dup = admin.post(f"{API}/invoices", json={
            "number": num,
            "items": [{"inventory_id": iid, "name": "TEST", "amount": 1, "price": 10}]}, timeout=30)
        assert dup.status_code == 400, dup.text


# ---------- Write-offs per warehouse ----------
class TestWriteoffPerWarehouse:
    def test_writeoff_decreases_that_warehouse(self, admin, whs, make_item):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        iid = make_item(balance=10, warehouse_id=bar["id"])
        before = next(x for x in inv_list(admin) if x["id"] == iid)
        b_bar, b_total = stock_of(before, bar["id"]), before["balance"]
        assert b_bar == 10

        r = admin.post(f"{API}/writeoffs", json={
            "inventory_id": iid, "amount": 2, "reason": "TEST_Списание",
            "warehouse_id": bar["id"]}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["warehouse_id"] == bar["id"] and body["kind"] == "manual"

        after = next(x for x in inv_list(admin) if x["id"] == iid)
        assert stock_of(after, bar["id"]) == b_bar - 2
        assert round(after["balance"], 3) == round(b_total - 2, 3)

        # writing off from another warehouse where there is no stock must fail
        over = admin.post(f"{API}/writeoffs", json={
            "inventory_id": iid, "amount": 1, "reason": "TEST_over",
            "warehouse_id": kitchen["id"]}, timeout=30)
        assert over.status_code == 400, over.text
        assert "Недостаточно" in over.json().get("detail", "")

        # more than per-warehouse stock
        over2 = admin.post(f"{API}/writeoffs", json={
            "inventory_id": iid, "amount": 999, "warehouse_id": bar["id"]}, timeout=30)
        assert over2.status_code == 400, over2.text

        # zero amount
        zero = admin.post(f"{API}/writeoffs", json={
            "inventory_id": iid, "amount": 0, "warehouse_id": bar["id"]}, timeout=30)
        assert zero.status_code == 400, zero.text


# ---------- Stock transfer ----------
class TestStockTransfer:
    def test_transfer_moves_stock(self, admin, whs, make_item):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        iid = make_item(balance=8, warehouse_id=bar["id"])
        before = next(x for x in inv_list(admin) if x["id"] == iid)
        b_bar, b_kit, b_total = stock_of(before, bar["id"]), stock_of(before, kitchen["id"]), before["balance"]

        r = admin.post(f"{API}/stock/transfer", json={
            "inventory_id": iid, "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 1.5}, timeout=30)
        assert r.status_code == 200, r.text

        after = next(x for x in inv_list(admin) if x["id"] == iid)
        assert stock_of(after, bar["id"]) == round(b_bar - 1.5, 4)
        assert stock_of(after, kitchen["id"]) == round(b_kit + 1.5, 4)
        assert round(after["balance"], 3) == round(b_total, 3), "aggregate balance must be unchanged"

        wos = admin.get(f"{API}/writeoffs", timeout=30).json()
        tr = next((w for w in wos if w.get("kind") == "transfer"
                   and w.get("inventory_id") == iid), None)
        assert tr, "transfer movement must be logged"
        assert tr["warehouse_id"] == bar["id"] and tr["to_warehouse_id"] == kitchen["id"]

    def test_transfer_validations(self, admin, whs, make_item):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        iid = make_item(balance=3, warehouse_id=bar["id"])
        # insufficient
        r = admin.post(f"{API}/stock/transfer", json={
            "inventory_id": iid, "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 10000}, timeout=30)
        assert r.status_code == 400 and "Недостаточно" in r.json().get("detail", ""), r.text
        # same warehouse
        r2 = admin.post(f"{API}/stock/transfer", json={
            "inventory_id": iid, "from_warehouse_id": bar["id"],
            "to_warehouse_id": bar["id"], "amount": 1}, timeout=30)
        assert r2.status_code == 400, r2.text
        # zero amount
        r3 = admin.post(f"{API}/stock/transfer", json={
            "inventory_id": iid, "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 0}, timeout=30)
        assert r3.status_code == 400, r3.text
        # stock unchanged after failures
        it = next(x for x in inv_list(admin) if x["id"] == iid)
        assert stock_of(it, bar["id"]) == 3 and it["balance"] == 3

    def test_transfer_requires_manager(self, cashier, whs):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        r = cashier.post(f"{API}/stock/transfer", json={
            "inventory_id": "ffffffffffffffffffffffff", "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 1}, timeout=30)
        assert r.status_code == 403, r.text


    def test_transfer_unknown_inventory(self, admin, whs):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        r = admin.post(f"{API}/stock/transfer", json={
            "inventory_id": "ffffffffffffffffffffffff", "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 1}, timeout=30)
        assert r.status_code in (400, 404), f"unexpected {r.status_code}: {r.text[:300]}"


# ---------- Automatic product cost ----------
class TestAutoCost:
    def test_auto_cost_from_recipe(self, admin, created):
        cats = admin.get(f"{API}/categories", timeout=30).json()
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        kitchen_ws = next(w for w in ws if w["name"] == "Кухня")
        # two ingredients with known costs
        i1 = admin.post(f"{API}/inventory", json={
            "name": f"TEST_Мука_{TS}", "measure": "kg", "cost": 200, "balance": 0}, timeout=30).json()
        i2 = admin.post(f"{API}/inventory", json={
            "name": f"TEST_Молоко_{TS}", "measure": "l", "cost": 80, "balance": 0}, timeout=30).json()
        created["inventory"] += [i1["id"], i2["id"]]

        recipe = [
            {"inventory_id": i1["id"], "name": i1["name"], "amount": 100, "unit": "g"},   # 0.1 kg * 200 = 20
            {"inventory_id": i2["id"], "name": i2["name"], "amount": 250, "unit": "ml"},  # 0.25 l * 80 = 20
        ]
        r = admin.post(f"{API}/products", json={
            "name": f"TEST_Блюдо_{TS}", "category_id": cats[0]["id"], "price": 500,
            "cost": 999, "cost_source": "auto", "workshop_id": kitchen_ws["id"],
            "recipe": recipe}, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        created["products"].append(p["id"])
        assert p["cost_source"] == "auto"
        assert p["cost"] == 40.0, f"expected auto cost 40, got {p['cost']}"

        # persisted
        prods = admin.get(f"{API}/products", timeout=30).json()
        got = next(x for x in prods if x["id"] == p["id"])
        assert got["cost"] == 40.0

        # invoice changing ingredient price recomputes auto product cost
        ri = admin.post(f"{API}/invoices", json={
            "number": f"TEST-COST-{TS}",
            "items": [{"inventory_id": i1["id"], "name": i1["name"], "amount": 1, "price": 400}]}, timeout=30)
        assert ri.status_code == 200, ri.text
        prods = admin.get(f"{API}/products", timeout=30).json()
        got = next(x for x in prods if x["id"] == p["id"])
        assert got["cost"] == 60.0, f"expected recomputed 60 (0.1*400 + 20), got {got['cost']}"

        # update to manual keeps supplied cost
        ru = admin.put(f"{API}/products/{p['id']}", json={
            "name": got["name"], "category_id": got["category_id"], "price": 500,
            "cost": 123.45, "cost_source": "manual", "workshop_id": kitchen_ws["id"],
            "recipe": recipe}, timeout=30)
        assert ru.status_code == 200, ru.text
        assert ru.json()["cost"] == 123.45
        prods = admin.get(f"{API}/products", timeout=30).json()
        assert next(x for x in prods if x["id"] == p["id"])["cost"] == 123.45

        # update back to auto recomputes
        ru2 = admin.put(f"{API}/products/{p['id']}", json={
            "name": got["name"], "category_id": got["category_id"], "price": 500,
            "cost": 0, "cost_source": "auto", "workshop_id": kitchen_ws["id"],
            "recipe": recipe}, timeout=30)
        assert ru2.status_code == 200, ru2.text
        assert ru2.json()["cost"] == 60.0

    def test_manual_product_cost_not_touched_by_invoice(self, admin, created):
        cats = admin.get(f"{API}/categories", timeout=30).json()
        i = admin.post(f"{API}/inventory", json={
            "name": f"TEST_Соль_{TS}", "measure": "kg", "cost": 10, "balance": 0}, timeout=30).json()
        created["inventory"].append(i["id"])
        p = admin.post(f"{API}/products", json={
            "name": f"TEST_Ручное_{TS}", "category_id": cats[0]["id"], "price": 100,
            "cost": 33.0, "cost_source": "manual",
            "recipe": [{"inventory_id": i["id"], "name": i["name"], "amount": 1, "unit": "kg"}]},
            timeout=30)
        assert p.status_code == 200, p.text
        pid = p.json()["id"]
        created["products"].append(pid)
        assert p.json()["cost"] == 33.0
        admin.post(f"{API}/invoices", json={
            "number": f"TEST-MAN-{TS}",
            "items": [{"inventory_id": i["id"], "name": i["name"], "amount": 1, "price": 777}]}, timeout=30)
        prods = admin.get(f"{API}/products", timeout=30).json()
        assert next(x for x in prods if x["id"] == pid)["cost"] == 33.0


# ---------- Sale auto write-off from workshop warehouse ----------
class TestSaleWriteoffWarehouse:
    def test_kitchen_sale_reduces_kitchen_warehouse(self, admin, waiter, cashier, whs):
        kitchen = next(w for w in whs if w["name"] == "Склад Кухня")
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        prods = admin.get(f"{API}/products", timeout=30).json()
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        kitchen_ws = next(w for w in ws if w["name"] == "Кухня")
        prod = next((p for p in prods
                     if p.get("workshop_id") == kitchen_ws["id"] and p.get("recipe")
                     and not p["name"].startswith("TEST_")), None)
        assert prod, "no seeded kitchen product with a recipe"

        # ensure enough stock on kitchen warehouse for the recipe ingredients
        items = {i["id"]: i for i in inv_list(admin)}
        for ing in prod["recipe"]:
            it = items.get(ing["inventory_id"])
            if it and stock_of(it, kitchen["id"]) < 5:
                admin.post(f"{API}/invoices", json={
                    "number": f"TEST-TOPUP-{TS}-{ing['inventory_id'][-4:]}",
                    "warehouse_id": kitchen["id"],
                    "items": [{"inventory_id": ing["inventory_id"], "name": it["name"],
                               "amount": 20, "price": it.get("cost", 0) or 10}]}, timeout=30)
        before = {i["id"]: i for i in inv_list(admin)}

        # ensure shift open
        cashier.post(f"{API}/shifts/open", timeout=30)
        tables = admin.get(f"{API}/tables", timeout=30).json()
        free = next((t for t in tables if not t.get("open_orders")), tables[0])
        ro = waiter.post(f"{API}/orders", json={
            "table_id": free["id"],
            "items": [{"product_id": prod["id"], "name": prod["name"],
                       "price": prod["price"], "count": 1}]}, timeout=30)
        assert ro.status_code == 200, ro.text
        oid = ro.json()["id"]
        rp = cashier.post(f"{API}/orders/{oid}/pay",
                          json={"payment_method": "cash", "discount": 0}, timeout=30)
        assert rp.status_code == 200, rp.text
        assert rp.json()["status"] == "closed"

        after = {i["id"]: i for i in inv_list(admin)}
        checked = 0
        for ing in prod["recipe"]:
            iid = ing["inventory_id"]
            if iid not in before:
                continue
            expected = round(before[iid]["stocks"] and stock_of(before[iid], kitchen["id"]) or 0, 4)
            got = stock_of(after[iid], kitchen["id"])
            assert got < expected, f"{ing['name']}: kitchen stock not decreased ({expected} -> {got})"
            # bar warehouse untouched
            assert stock_of(after[iid], bar["id"]) == stock_of(before[iid], bar["id"])
            checked += 1
        assert checked > 0

        # sale writeoff logged against kitchen warehouse
        wos = admin.get(f"{API}/writeoffs", timeout=30).json()
        sale = [w for w in wos if w.get("kind") == "sale"][:5]
        assert sale, "no sale writeoffs found"
        assert sale[0]["warehouse_id"] == kitchen["id"], sale[0]


# ---------- Reports ----------
class TestReports:
    def test_report_inventory(self, admin, whs):
        r = admin.get(f"{API}/reports/inventory", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["rows"] and isinstance(d["warehouses"], list)
        assert len(d["warehouses"]) == len(whs)
        for row in d["rows"]:
            assert abs(row["value"] - round(row["quantity"] * row["cost"], 2)) < 0.02
            assert row["warehouse_name"] != "—"
        assert abs(d["total_value"] - round(sum(x["value"] for x in d["rows"]), 2)) < 0.05

        bar = next(w for w in whs if w["name"] == "Склад Бар")
        r2 = admin.get(f"{API}/reports/inventory", params={"warehouse_id": bar["id"]}, timeout=30)
        assert r2.status_code == 200
        assert all(x["warehouse_id"] == bar["id"] for x in r2.json()["rows"])
        assert len(r2.json()["rows"]) <= len(d["rows"])

    def test_report_stock_movement(self, admin, whs, make_item):
        bar = next(w for w in whs if w["name"] == "Склад Бар")
        kitchen = next(w for w in whs if w["is_default"])
        iid = make_item()
        # in 6 via invoice on bar, out 2 via writeoff on bar, 1 transferred (must be excluded)
        assert admin.post(f"{API}/invoices", json={
            "number": f"TEST-MOVE-{TS}-{iid[-5:]}", "warehouse_id": bar["id"],
            "items": [{"inventory_id": iid, "name": "TEST", "amount": 6, "price": 20}]},
            timeout=30).status_code == 200
        assert admin.post(f"{API}/writeoffs", json={
            "inventory_id": iid, "amount": 2, "warehouse_id": bar["id"],
            "reason": "TEST_move"}, timeout=30).status_code == 200
        assert admin.post(f"{API}/stock/transfer", json={
            "inventory_id": iid, "from_warehouse_id": bar["id"],
            "to_warehouse_id": kitchen["id"], "amount": 1}, timeout=30).status_code == 200

        today = dt.date.today().isoformat()
        r = admin.get(f"{API}/reports/stock-movement",
                      params={"start": today, "end": today}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["rows"], list) and d["rows"], d
        row = next((x for x in d["rows"] if x["inventory_id"] == iid), None)
        assert row, "test item movements missing from report"
        assert row["in_qty"] == 6, row
        assert row["out_qty"] == 2, f"transfers must not count as out: {row}"
        assert abs(row["net"] - 4) < 0.001, row

        r2 = admin.get(f"{API}/reports/stock-movement",
                       params={"warehouse_id": bar["id"], "start": today, "end": today}, timeout=30)
        assert r2.status_code == 200
        row2 = next((x for x in r2.json()["rows"] if x["inventory_id"] == iid), None)
        assert row2 and row2["in_qty"] == 6 and row2["out_qty"] == 2, row2
        # filtered by the OTHER warehouse -> no movements for this item
        r4 = admin.get(f"{API}/reports/stock-movement",
                       params={"warehouse_id": kitchen["id"], "start": today, "end": today}, timeout=30)
        assert r4.status_code == 200
        assert not any(x["inventory_id"] == iid for x in r4.json()["rows"])

        # empty range
        r3 = admin.get(f"{API}/reports/stock-movement",
                       params={"start": "2000-01-01", "end": "2000-01-02"}, timeout=30)
        assert r3.status_code == 200 and r3.json()["rows"] == []

    def test_reports_require_manager(self, cashier):
        for path in ("/reports/inventory", "/reports/stock-movement"):
            assert cashier.get(f"{API}{path}", timeout=30).status_code == 403


# ---------- cleanup of test invoices/writeoffs documents ----------
def test_zz_cleanup_movement_docs(admin):
    """Remove TEST_ invoices/writeoffs rows are kept only if API supports delete; report otherwise."""
    invs = admin.get(f"{API}/invoices", timeout=30).json()
    test_invs = [i for i in invs if str(i.get("number", "")).startswith("TEST-")]
    # no delete endpoint expected; just assert they are visible/consistent
    for i in test_invs:
        assert i.get("warehouse_id"), i
