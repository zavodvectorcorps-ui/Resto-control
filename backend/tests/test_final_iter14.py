"""Tasks 12 / 14 / 15 backend suite (iteration 14).

Covers:
- Task 14: payment methods CRUD, debt payment flow, pay-debt, /reports/debts, cashback suppression
- Task 12: quick comments CRUD + context validation, cash movements, cancel-order reason
- Task 15: course numbers on category/product/order item + kitchen ticket grouping
"""
import pytest
import requests

from conftest import API


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _open_shift(cashier):
    r = cashier.post(f"{API}/shifts/open")
    assert r.status_code == 200, r.text
    return r.json()


def _pick_product(sess, category_name=None):
    r = sess.get(f"{API}/products")
    assert r.status_code == 200, r.text
    prods = r.json()
    cats = {c["id"]: c["name"] for c in sess.get(f"{API}/categories").json()}
    for p in prods:
        if p.get("modifier_group_ids"):
            continue
        if category_name and cats.get(p.get("category_id")) != category_name:
            continue
        return p
    return prods[0]


def _get_client(sess, cid):
    """No GET /api/clients/{id} exists — read from the list endpoint."""
    for c in sess.get(f"{API}/clients").json():
        if c["id"] == cid:
            return c
    raise AssertionError(f"client {cid} not found in /clients")


def _get_product(sess, pid):
    for p in sess.get(f"{API}/products").json():
        if p["id"] == pid:
            return p
    raise AssertionError(f"product {pid} not found")


def _create_order(sess, items):
    r = sess.post(f"{API}/orders", json={"table_id": None, "items": items})
    assert r.status_code == 200, r.text
    return r.json()


# ==========================================================================
# Task 14 — payment methods
# ==========================================================================
class TestPaymentMethods:
    created = []

    def test_seeded_defaults_present(self, admin):
        r = admin.get(f"{API}/payment-methods")
        assert r.status_code == 200, r.text
        pms = r.json()
        assert all("_id" not in p for p in pms), "mongo _id leaked"
        codes = {p["code"]: p for p in pms}
        for c in ("cash", "card", "debt"):
            assert c in codes, f"missing seeded payment method {c}: {codes.keys()}"
        assert codes["debt"]["is_debt"] is True
        assert codes["cash"]["is_debt"] is False
        assert codes["cash"]["active"] is True

    def test_crud_and_persistence(self, admin):
        r = admin.post(f"{API}/payment-methods", json={
            "name": "TEST_Сертификат", "code": "test_cert", "is_debt": False,
            "active": True, "position": 99})
        assert r.status_code == 200, r.text
        pm = r.json()
        assert pm["name"] == "TEST_Сертификат"
        assert pm["code"] == "test_cert"
        pmid = pm["id"]
        TestPaymentMethods.created.append(pmid)

        # GET verify persisted
        got = [p for p in admin.get(f"{API}/payment-methods").json() if p["id"] == pmid]
        assert len(got) == 1 and got[0]["position"] == 99

        # UPDATE
        r = admin.put(f"{API}/payment-methods/{pmid}", json={
            "name": "TEST_Сертификат2", "code": "test_cert", "is_debt": True,
            "active": False, "position": 98})
        assert r.status_code == 200, r.text
        assert r.json()["is_debt"] is True
        got = [p for p in admin.get(f"{API}/payment-methods").json() if p["id"] == pmid][0]
        assert got["name"] == "TEST_Сертификат2" and got["active"] is False

        # DELETE
        assert admin.delete(f"{API}/payment-methods/{pmid}").status_code == 200
        assert not [p for p in admin.get(f"{API}/payment-methods").json() if p["id"] == pmid]
        TestPaymentMethods.created.remove(pmid)
        # delete twice -> 404
        assert admin.delete(f"{API}/payment-methods/{pmid}").status_code == 404

    def test_write_requires_manager(self, cashier):
        r = cashier.post(f"{API}/payment-methods", json={"name": "TEST_x", "code": "test_x"})
        assert r.status_code == 403, f"cashier could create payment method: {r.status_code}"

    def test_read_allowed_for_cashier(self, cashier):
        assert cashier.get(f"{API}/payment-methods").status_code == 200

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, admin):
        yield
        for pid in list(TestPaymentMethods.created):
            admin.delete(f"{API}/payment-methods/{pid}")


# ==========================================================================
# Task 14 — debts
# ==========================================================================
class TestDebts:
    @pytest.fixture(scope="class")
    def client_id(self, admin):
        r = admin.get(f"{API}/clients")
        assert r.status_code == 200
        for c in r.json():
            if c.get("name") == "Иван Петров":
                return c["id"]
        pytest.fail("demo client 'Иван Петров' not found")

    def test_debt_pay_requires_client(self, cashier, admin):
        _open_shift(cashier)
        p = _pick_product(cashier)
        o = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                     "price": p["price"], "count": 1}])
        r = cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "debt", "discount": 0})
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
        assert "долг" in r.json()["detail"].lower()
        # order must still be open
        assert cashier.get(f"{API}/orders/{o['id']}").json()["status"] != "closed"
        cashier.delete(f"{API}/orders/{o['id']}", json={"reason": "TEST cleanup"})

    def test_debt_pay_increases_balance_and_no_cashback(self, cashier, admin, client_id):
        _open_shift(cashier)
        before = _get_client(admin, client_id)
        bal0 = before.get("debt_balance", 0) or 0
        bonus0 = before.get("bonus_balance", 0) or 0

        p = _pick_product(cashier)
        o = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                     "price": p["price"], "count": 1}])
        r = cashier.post(f"{API}/orders/{o['id']}/pay", json={
            "payment_method": "debt", "discount": 0, "client_id": client_id})
        assert r.status_code == 200, r.text
        paid = r.json()
        total = paid["total"]
        assert paid["is_debt"] is True
        assert paid["status"] == "closed"

        after = _get_client(admin, client_id)
        assert round(after["debt_balance"], 2) == round(bal0 + total, 2), \
            f"debt {bal0} + {total} != {after['debt_balance']}"
        assert round(after.get("bonus_balance", 0) or 0, 2) == round(bonus0, 2), \
            "cashback accrued on a debt payment"
        TestDebts.debt_amount = total
        TestDebts.order_id = paid["id"]

    def test_debts_report(self, admin, client_id):
        r = admin.get(f"{API}/reports/debts")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and "total" in data
        row = [c for c in data["rows"] if c["id"] == client_id]
        assert row, "client with debt missing from /reports/debts"
        assert row[0]["debt_balance"] > 0
        assert all("_id" not in c for c in data["rows"])
        assert round(data["total"], 2) == round(sum(c["debt_balance"] for c in data["rows"]), 2)

    def test_debts_report_manager_only(self, cashier):
        assert cashier.get(f"{API}/reports/debts").status_code == 403

    def test_pay_debt_partial_then_full(self, cashier, admin, client_id):
        bal = _get_client(admin, client_id)["debt_balance"]
        assert bal > 0
        part = round(bal / 2, 2)
        r = cashier.post(f"{API}/clients/{client_id}/pay-debt",
                         json={"amount": part, "payment_method": "cash"})
        assert r.status_code == 200, r.text
        assert round(r.json()["paid"], 2) == part
        assert round(r.json()["debt_balance"], 2) == round(bal - part, 2)
        assert round(_get_client(admin, client_id)["debt_balance"], 2) == round(bal - part, 2)

        # overpay is capped
        r = cashier.post(f"{API}/clients/{client_id}/pay-debt",
                         json={"amount": 999999, "payment_method": "cash"})
        assert r.status_code == 200, r.text
        assert r.json()["debt_balance"] == 0
        assert _get_client(admin, client_id)["debt_balance"] == 0

    def test_pay_debt_no_debt_or_bad_amount(self, cashier, client_id):
        r = cashier.post(f"{API}/clients/{client_id}/pay-debt", json={"amount": 100})
        assert r.status_code == 400, r.text
        r = cashier.post(f"{API}/clients/{client_id}/pay-debt", json={"amount": -5})
        assert r.status_code == 400

    def test_debt_transactions_logged(self, admin, client_id):
        r = admin.get(f"{API}/clients/{client_id}/debt-transactions")
        assert r.status_code == 200, r.text
        types = [t["type"] for t in r.json()]
        assert "charge" in types and "payment" in types

    def test_pay_debt_unknown_client_404(self, cashier):
        assert cashier.post(f"{API}/clients/507f1f77bcf86cd799439011/pay-debt",
                            json={"amount": 10}).status_code == 404

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, admin):
        yield
        oid = getattr(TestDebts, "order_id", None)
        if oid:
            requests.delete(f"{API}/__noop__")  # placeholder, closed orders removed by cleanup script


# ==========================================================================
# Task 12 — quick comments
# ==========================================================================
class TestQuickComments:
    created = []

    def test_seeded_and_context_filter(self, admin):
        r = admin.get(f"{API}/quick-comments")
        assert r.status_code == 200, r.text
        all_qc = r.json()
        assert len(all_qc) > 0, "no seeded quick comments"
        assert all("_id" not in q for q in all_qc)
        for ctx in ("dish", "order", "cancel"):
            rr = admin.get(f"{API}/quick-comments", params={"context": ctx})
            assert rr.status_code == 200
            assert all(q["context"] == ctx for q in rr.json())
            assert len(rr.json()) > 0, f"no seeded quick comments for context {ctx}"

    def test_crud(self, admin):
        r = admin.post(f"{API}/quick-comments", json={"text": "TEST_без лука", "context": "dish"})
        assert r.status_code == 200, r.text
        qc = r.json()
        assert qc["text"] == "TEST_без лука" and qc["context"] == "dish"
        qid = qc["id"]
        TestQuickComments.created.append(qid)

        got = [q for q in admin.get(f"{API}/quick-comments", params={"context": "dish"}).json() if q["id"] == qid]
        assert len(got) == 1

        r = admin.put(f"{API}/quick-comments/{qid}", json={"text": "TEST_без соли", "context": "cancel"})
        assert r.status_code == 200, r.text
        assert r.json()["context"] == "cancel"
        got = [q for q in admin.get(f"{API}/quick-comments").json() if q["id"] == qid][0]
        assert got["text"] == "TEST_без соли" and got["context"] == "cancel"

        assert admin.delete(f"{API}/quick-comments/{qid}").status_code == 200
        assert not [q for q in admin.get(f"{API}/quick-comments").json() if q["id"] == qid]
        TestQuickComments.created.remove(qid)
        assert admin.delete(f"{API}/quick-comments/{qid}").status_code == 404

    def test_invalid_context_422(self, admin):
        r = admin.post(f"{API}/quick-comments", json={"text": "TEST_bad", "context": "banana"})
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text[:200]}"

    def test_manager_only_write(self, cashier):
        assert cashier.post(f"{API}/quick-comments", json={"text": "TEST_x"}).status_code == 403

    def test_read_allowed_for_waiter(self, waiter):
        assert waiter.get(f"{API}/quick-comments", params={"context": "dish"}).status_code == 200

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, admin):
        yield
        for qid in list(TestQuickComments.created):
            admin.delete(f"{API}/quick-comments/{qid}")


# ==========================================================================
# Task 12 — cash movements
# ==========================================================================
class TestCashMovements:
    def test_movement_in_out_and_list(self, cashier):
        shift = _open_shift(cashier)
        r = cashier.post(f"{API}/shifts/cash-movement",
                         json={"type": "in", "amount": 500, "reason": "TEST размен"})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["type"] == "in" and m["amount"] == 500 and m["shift_id"] == shift["id"]
        assert "_id" not in m and m.get("staff_name")

        r = cashier.post(f"{API}/shifts/cash-movement",
                         json={"type": "out", "amount": 120.5, "reason": "TEST инкассация"})
        assert r.status_code == 200, r.text

        r = cashier.get(f"{API}/shifts/cash-movements")
        assert r.status_code == 200
        movs = r.json()
        assert any(x["type"] == "in" and x["amount"] == 500 for x in movs)
        assert any(x["type"] == "out" and x["amount"] == 120.5 for x in movs)
        assert all(x["shift_id"] == shift["id"] for x in movs)

    def test_bad_amount_400(self, cashier):
        _open_shift(cashier)
        r = cashier.post(f"{API}/shifts/cash-movement", json={"type": "in", "amount": 0})
        assert r.status_code == 400, r.text
        r = cashier.post(f"{API}/shifts/cash-movement", json={"type": "out", "amount": -10})
        assert r.status_code == 400

    def test_bad_type_422(self, cashier):
        r = cashier.post(f"{API}/shifts/cash-movement", json={"type": "sideways", "amount": 10})
        assert r.status_code == 422, r.text

    def test_admin_role_required(self, waiter):
        r = waiter.post(f"{API}/shifts/cash-movement", json={"type": "in", "amount": 10})
        assert r.status_code == 403, f"waiter could record a cash movement: {r.status_code}"


# ==========================================================================
# Task 12 — cancel order reason
# ==========================================================================
class TestCancelReason:
    def test_unsent_order_deletes_without_reason(self, cashier):
        _open_shift(cashier)
        p = _pick_product(cashier)
        o = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                     "price": p["price"], "count": 1}])
        r = cashier.delete(f"{API}/orders/{o['id']}")
        assert r.status_code == 200, r.text
        assert cashier.get(f"{API}/orders/{o['id']}").status_code == 404

    def test_sent_order_requires_reason(self, cashier, admin):
        _open_shift(cashier)
        p = _pick_product(cashier)
        o = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                     "price": p["price"], "count": 1}])
        s = cashier.post(f"{API}/orders/{o['id']}/send")
        assert s.status_code == 200, s.text

        r = cashier.delete(f"{API}/orders/{o['id']}", json={"reason": ""})
        assert r.status_code == 400, f"expected 400 without reason, got {r.status_code}"
        assert r.json()["detail"] == "Укажите причину отмены заказа"
        r = cashier.delete(f"{API}/orders/{o['id']}", json={"reason": "   "})
        assert r.status_code == 400, "whitespace-only reason accepted"
        assert cashier.get(f"{API}/orders/{o['id']}").status_code == 200, "order deleted despite 400"

        r = cashier.delete(f"{API}/orders/{o['id']}", json={"reason": "TEST гость ушёл"})
        assert r.status_code == 200, r.text
        assert cashier.get(f"{API}/orders/{o['id']}").status_code == 404

        corr = admin.get(f"{API}/reports/corrections").json()
        rows = corr["rows"] if isinstance(corr, dict) else corr
        assert any(c.get("order_id") == o["id"] and "TEST гость ушёл" in (c.get("reason") or "")
                   for c in rows), "cancellation not logged in order_corrections"


# ==========================================================================
# Task 15 — serving courses
# ==========================================================================
class TestCourses:
    state = {}

    def test_category_course_number_crud(self, admin):
        cats = admin.get(f"{API}/categories").json()
        cat = cats[0]
        TestCourses.state["cat_id"] = cat["id"]
        TestCourses.state["cat_course_orig"] = cat.get("course_number", 0)
        payload = {k: cat.get(k) for k in ("name", "color", "workshop_id", "position") if k in cat}
        payload["course_number"] = 2
        r = admin.put(f"{API}/categories/{cat['id']}", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["course_number"] == 2
        got = [c for c in admin.get(f"{API}/categories").json() if c["id"] == cat["id"]][0]
        assert got["course_number"] == 2

    def test_products_resolve_category_course(self, admin):
        cat_id = TestCourses.state["cat_id"]
        prods = [p for p in admin.get(f"{API}/products").json() if p.get("category_id") == cat_id]
        assert prods, "category has no products"
        for p in prods:
            assert p["course_number"] == 2, f"{p['name']} course {p['course_number']} != inherited 2"
        TestCourses.state["prod"] = prods[0]

    def test_product_override_wins(self, admin):
        p = TestCourses.state["prod"]
        full = _get_product(admin, p["id"])
        payload = {"name": full["name"], "category_id": full["category_id"],
                   "price": full["price"], "workshop_id": full.get("workshop_id"),
                   "course_number": 4}
        r = admin.put(f"{API}/products/{p['id']}", json=payload)
        assert r.status_code == 200, r.text
        got = [x for x in admin.get(f"{API}/products").json() if x["id"] == p["id"]][0]
        assert got["course_number"] == 4, "product override not applied"
        # revert override
        payload["course_number"] = None
        assert admin.put(f"{API}/products/{p['id']}", json=payload).status_code == 200
        got = [x for x in admin.get(f"{API}/products").json() if x["id"] == p["id"]][0]
        assert got["course_number"] == 2, "clearing override did not fall back to category"

    def test_order_item_course_and_comment_persist(self, cashier, admin):
        _open_shift(cashier)
        printers = admin.get(f"{API}/printers").json()
        wids = {pr.get("workshop_id") for pr in printers if pr.get("active") and pr.get("workshop_id")}
        prods = [p for p in cashier.get(f"{API}/products").json()
                 if not p.get("modifier_group_ids") and p.get("workshop_id") in wids]
        by_ws = {}
        for p in prods:
            by_ws.setdefault(p["workshop_id"], []).append(p)
        same = next((v for v in by_ws.values() if len(v) >= 2), None)
        assert same, f"no printed workshop with 2+ simple products (printer workshops={wids})"
        a, b = same[0], same[1]
        o = _create_order(cashier, [
            {"product_id": b["id"], "name": b["name"], "price": b["price"], "count": 1,
             "workshop_id": b["workshop_id"], "course_number": 3, "comment": "TEST без соли"},
            {"product_id": a["id"], "name": a["name"], "price": a["price"], "count": 1,
             "workshop_id": a["workshop_id"], "course_number": 1, "comment": ""},
        ])
        got = cashier.get(f"{API}/orders/{o['id']}").json()
        courses = {i["name"]: i.get("course_number") for i in got["items"]}
        assert courses.get(b["name"]) == 3 and courses.get(a["name"]) == 1
        assert [i for i in got["items"] if i["name"] == b["name"]][0]["comment"] == "TEST без соли"
        TestCourses.state["order_id"] = o["id"]
        TestCourses.state["names"] = (a["name"], b["name"])

    def test_ticket_groups_by_course(self, cashier, admin):
        oid = TestCourses.state["order_id"]
        r = cashier.post(f"{API}/orders/{oid}/send")
        assert r.status_code == 200, r.text
        jobs = admin.get(f"{API}/print-jobs")
        assert jobs.status_code == 200, jobs.text
        text = "\n".join(j.get("text") or "" for j in jobs.json() if j.get("order_id") == oid)
        assert text.strip(), "no print job text produced for the sent order (no active printer?)"
        assert "-- Подача 1 --" in text, f"missing course header 1 in:\n{text}"
        assert "-- Подача 3 --" in text, f"missing course header 3 in:\n{text}"
        assert "* TEST без соли" in text, f"item comment not printed in:\n{text}"
        # course 1 header must appear before course 3 header
        assert text.index("-- Подача 1 --") < text.index("-- Подача 3 --")
        cashier.delete(f"{API}/orders/{oid}", json={"reason": "TEST cleanup"})

    @pytest.fixture(scope="class", autouse=True)
    def _restore(self, admin):
        yield
        cat_id = TestCourses.state.get("cat_id")
        if cat_id:
            cat = [c for c in admin.get(f"{API}/categories").json() if c["id"] == cat_id]
            if cat:
                c = cat[0]
                payload = {k: c.get(k) for k in ("name", "color", "workshop_id", "position") if k in c}
                payload["course_number"] = TestCourses.state.get("cat_course_orig", 0)
                admin.put(f"{API}/categories/{cat_id}", json=payload)


# ==========================================================================
# Regression — cash/card pay still works; close_shift totals
# ==========================================================================
class TestRegression:
    def test_cash_pay_and_shift_totals(self, cashier, admin):
        _open_shift(cashier)
        p = _pick_product(cashier)
        o = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                     "price": p["price"], "count": 2}])
        r = cashier.post(f"{API}/orders/{o['id']}/pay", json={"payment_method": "cash", "discount": 0})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "closed" and r.json()["is_debt"] is False

        o2 = _create_order(cashier, [{"product_id": p["id"], "name": p["name"],
                                      "price": p["price"], "count": 1}])
        r = cashier.post(f"{API}/orders/{o2['id']}/pay", json={"payment_method": "card", "discount": 0})
        assert r.status_code == 200, r.text
        assert r.json()["payment_method"] == "card"

    def test_close_shift_summary_fields(self, cashier):
        _open_shift(cashier)
        cashier.post(f"{API}/shifts/cash-movement", json={"type": "in", "amount": 1000, "reason": "TEST"})
        cashier.post(f"{API}/shifts/cash-movement", json={"type": "out", "amount": 250, "reason": "TEST"})
        # close any open orders created by this suite
        for o in cashier.get(f"{API}/orders").json():
            if o.get("status") in ("open", "sent"):
                cashier.delete(f"{API}/orders/{o['id']}", json={"reason": "TEST cleanup"})
        r = cashier.post(f"{API}/shifts/close")
        assert r.status_code == 200, r.text
        s = r.json()
        for k in ("cash_in", "cash_out", "expected_cash", "total_debt", "total_cash", "total_card"):
            assert k in s, f"close_shift summary missing {k}: {list(s.keys())}"
        assert s["cash_in"] >= 1000 and s["cash_out"] >= 250
        assert round(s["expected_cash"], 2) == round(s["total_cash"] + s["cash_in"] - s["cash_out"], 2)
        # reopen for UI testing
        _open_shift(cashier)
