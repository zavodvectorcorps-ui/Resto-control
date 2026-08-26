"""Iteration 10 — edge cases / data-integrity probes for the multi-warehouse feature."""
import datetime as dt

import pytest

from conftest import API

TS = dt.datetime.utcnow().strftime("%H%M%S")


def inv_of(admin, iid):
    r = admin.get(f"{API}/inventory", timeout=30)
    assert r.status_code == 200
    return next((x for x in r.json() if x["id"] == iid), None)


def sum_stocks(item):
    return round(sum(s["quantity"] for s in item.get("stocks", [])), 4)


class TestWarehouseDeletionIntegrity:
    """Deleting a warehouse that still holds stock must not desync inventory.balance."""

    def test_delete_warehouse_with_stock_keeps_balance_consistent(self, admin):
        wh = admin.post(f"{API}/warehouses", json={"name": f"TEST_DEL_{TS}"}, timeout=30).json()
        it = admin.post(f"{API}/inventory", json={
            "name": f"TEST_DELITEM_{TS}", "measure": "kg", "cost": 10,
            "balance": 5, "warehouse_id": wh["id"]}, timeout=30).json()
        iid = it["id"]
        before = inv_of(admin, iid)
        assert before["balance"] == 5 and sum_stocks(before) == 5

        assert admin.delete(f"{API}/warehouses/{wh['id']}", timeout=30).status_code == 200
        after = inv_of(admin, iid)
        try:
            assert after["balance"] == sum_stocks(after), (
                f"balance={after['balance']} but sum(stocks)={sum_stocks(after)} "
                "after deleting a warehouse that still held 5 kg")
        finally:
            admin.delete(f"{API}/inventory/{iid}", timeout=30)


class TestInventoryUpdateBalance:
    """PUT /inventory accepts a balance field but silently ignores it."""

    def test_put_inventory_balance_is_ignored(self, admin):
        it = admin.post(f"{API}/inventory", json={
            "name": f"TEST_PUT_{TS}", "measure": "kg", "cost": 10, "balance": 2}, timeout=30).json()
        iid = it["id"]
        try:
            r = admin.put(f"{API}/inventory/{iid}", json={
                "name": f"TEST_PUT_{TS}", "measure": "kg", "cost": 10, "balance": 99}, timeout=30)
            assert r.status_code == 200, r.text
            after = inv_of(admin, iid)
            assert after["balance"] == 2, (
                "documented behaviour: balance in PUT payload is ignored "
                f"(got {after['balance']})")
            assert sum_stocks(after) == 2
        finally:
            admin.delete(f"{API}/inventory/{iid}", timeout=30)


class TestSaleGoesNegative:
    """A paid order writes off ingredients even when the workshop warehouse has no stock."""

    def test_sale_can_drive_warehouse_stock_negative(self, admin, waiter, cashier):
        whs = admin.get(f"{API}/warehouses", timeout=30).json()
        kitchen = next(w for w in whs if w["name"] == "Склад Кухня")
        cats = admin.get(f"{API}/categories", timeout=30).json()
        ws = admin.get(f"{API}/workshops", timeout=30).json()
        kws = next(w for w in ws if w["name"] == "Кухня")
        ing = admin.post(f"{API}/inventory", json={
            "name": f"TEST_NEG_{TS}", "measure": "kg", "cost": 10, "balance": 0}, timeout=30).json()
        prod = admin.post(f"{API}/products", json={
            "name": f"TEST_NEG_PROD_{TS}", "category_id": cats[0]["id"], "price": 10,
            "cost": 0, "cost_source": "manual", "workshop_id": kws["id"],
            "recipe": [{"inventory_id": ing["id"], "name": ing["name"],
                        "amount": 1, "unit": "kg"}]}, timeout=30).json()
        try:
            cashier.post(f"{API}/shifts/open", timeout=30)
            tables = admin.get(f"{API}/tables", timeout=30).json()
            t = next((x for x in tables if not x.get("open_orders")), tables[0])
            o = waiter.post(f"{API}/orders", json={
                "table_id": t["id"],
                "items": [{"product_id": prod["id"], "name": prod["name"],
                           "price": 10, "count": 1}]}, timeout=30)
            assert o.status_code == 200, o.text
            p = cashier.post(f"{API}/orders/{o.json()['id']}/pay",
                             json={"payment_method": "cash", "discount": 0}, timeout=30)
            assert p.status_code == 200, p.text
            after = inv_of(admin, ing["id"])
            neg = next((s for s in after["stocks"] if s["warehouse_id"] == kitchen["id"]), None)
            assert neg is not None
            assert neg["quantity"] >= 0, (
                f"sale drove {kitchen['name']} stock negative: {neg['quantity']} "
                "(no stock guard / no warning on pay)")
        finally:
            admin.delete(f"{API}/products/{prod['id']}", timeout=30)
            admin.delete(f"{API}/inventory/{ing['id']}", timeout=30)
