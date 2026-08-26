"""Iteration 11 edge/integrity probes for Task 3 & 4. Failures here document real defects."""
import pytest

from conftest import API


def _shift(cashier):
    r = cashier.get(f"{API}/shifts/current", timeout=30)
    if not (r.status_code == 200 and r.json()):
        cashier.post(f"{API}/shifts/open", json={"opening_cash": 1000}, timeout=30)


def _burger(admin):
    return next(p for p in admin.get(f"{API}/products", timeout=30).json()
                if p["name"] == "Классический бургер")


def _cheese(admin):
    for g in admin.get(f"{API}/modifier-groups", timeout=30).json():
        for o in g["options"]:
            if o["name"] == "Доп. сыр":
                return g, o
    pytest.fail("no Доп. сыр")


class TestModifierPriceIntegrity:
    def test_price_delta_is_validated_against_db(self, admin, waiter, cashier):
        """Client-supplied price_delta must not be trusted."""
        _shift(cashier)
        b = _burger(admin)
        g, o = _cheese(admin)
        item = {"product_id": b["id"], "name": b["name"], "price": b["price"], "count": 1,
                "selected_modifiers": [{"group_id": g["id"], "option_id": o["id"],
                                        "name": o["name"], "price_delta": -100.0}]}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        oid = r.json().get("id")
        try:
            sub = r.json().get("subtotal")
            assert sub == round(b["price"] + o["price_delta"], 2), \
                f"forged price_delta accepted -> subtotal {sub} (expected {b['price'] + o['price_delta']})"
        finally:
            if oid:
                waiter.delete(f"{API}/orders/{oid}", timeout=30)

    def test_max_count_enforced_server_side(self, admin, waiter, cashier):
        """Группа 'Добавки' has max_count=3 — sending 4 duplicates of the same option should be rejected."""
        _shift(cashier)
        b = _burger(admin)
        g, o = _cheese(admin)
        mods = [{"group_id": g["id"], "option_id": o["id"], "name": o["name"],
                 "price_delta": o["price_delta"]} for _ in range(4)]
        item = {"product_id": b["id"], "name": b["name"], "price": b["price"], "count": 1,
                "selected_modifiers": mods}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        oid = r.json().get("id")
        try:
            assert r.status_code == 400, \
                f"max_count not enforced (status {r.status_code}, subtotal {r.json().get('subtotal')})"
        finally:
            if oid:
                waiter.delete(f"{API}/orders/{oid}", timeout=30)

    def test_option_must_belong_to_products_groups(self, admin, waiter, cashier):
        """A modifier from a group not attached to the product should be rejected."""
        _shift(cashier)
        prods = admin.get(f"{API}/products", timeout=30).json()
        plain = next((p for p in prods if not p.get("modifier_group_ids")), None)
        if not plain:
            pytest.skip("no product without modifier groups")
        g, o = _cheese(admin)
        item = {"product_id": plain["id"], "name": plain["name"], "price": plain["price"], "count": 1,
                "selected_modifiers": [{"group_id": g["id"], "option_id": o["id"],
                                        "name": o["name"], "price_delta": o["price_delta"]}]}
        r = waiter.post(f"{API}/orders", json={"items": [item]}, timeout=30)
        oid = r.json().get("id")
        try:
            assert r.status_code == 400, f"unrelated modifier accepted (status {r.status_code})"
        finally:
            if oid:
                waiter.delete(f"{API}/orders/{oid}", timeout=30)


class TestClientLookupStrictness:
    def test_phone_lookup_is_exact_not_substring(self, admin):
        """?phone= uses an unanchored $regex, so a partial number matches the wrong client."""
        r = admin.get(f"{API}/clients", params={"phone": "123"}, timeout=30)
        assert r.status_code == 404, \
            f"substring '123' matched client {r.json().get('name')!r} — lookup is not exact"


class TestModifierValidation:
    def test_update_unknown_group_returns_404(self, admin):
        r = admin.put(f"{API}/modifier-groups/ffffffffffffffffffffffff",
                      json={"name": "TEST_ghost"}, timeout=30)
        assert r.status_code == 404, f"got {r.status_code} body={r.text[:200]}"

    def test_invalid_selection_type_rejected(self, admin):
        r = admin.post(f"{API}/modifier-groups",
                       json={"name": "TEST_badtype", "selection_type": "bogus"}, timeout=30)
        if r.status_code == 200:
            admin.delete(f"{API}/modifier-groups/{r.json()['id']}", timeout=30)
        assert r.status_code in (400, 422), "selection_type is not validated"

    def test_delete_unknown_client_404(self, admin):
        r = admin.delete(f"{API}/clients/ffffffffffffffffffffffff", timeout=30)
        assert r.status_code == 404, f"deleting a non-existent client returns {r.status_code}"
