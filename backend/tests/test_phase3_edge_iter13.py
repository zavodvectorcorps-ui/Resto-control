# Module: Phase 3 edge cases — link-reservation with bogus order, empty refund, reservation status validation, waiter permissions
from conftest import API
import datetime

TODAY = datetime.date.today().isoformat()


class TestPhase3Edges:
    def test_link_reservation_with_nonexistent_order(self, admin, cashier):
        rv = admin.post(f"{API}/reservations", json={
            "date": TODAY, "time_from": "10:00", "guest_name": "TEST_Edge",
            "guests_count": 1, "deposit_amount": 10}, timeout=30).json()
        try:
            r = cashier.post(f"{API}/orders/000000000000000000000000/link-reservation",
                             json={"reservation_id": rv["id"]}, timeout=30)
            print("link with bogus order status:", r.status_code, r.text[:200])
            after = next(x for x in admin.get(f"{API}/reservations", timeout=30).json() if x["id"] == rv["id"])
            print("reservation status after bogus link:", after["status"], "order_id:", after["order_id"])
            assert r.status_code == 404, (
                f"link-reservation returns {r.status_code} for a non-existent order and still marks "
                f"reservation seated (status={after['status']})")
        finally:
            admin.delete(f"{API}/reservations/{rv['id']}", timeout=30)

    def test_reservation_status_enum_validation(self, admin):
        rv = admin.post(f"{API}/reservations", json={
            "date": TODAY, "time_from": "10:30", "guest_name": "TEST_Enum",
            "guests_count": 1}, timeout=30).json()
        try:
            r = admin.patch(f"{API}/reservations/{rv['id']}", json={"status": "banana"}, timeout=30)
            print("patch invalid status ->", r.status_code, r.json().get("status") if r.status_code == 200 else "")
            assert r.status_code in (400, 422), f"arbitrary status accepted: {r.status_code}"
        finally:
            admin.delete(f"{API}/reservations/{rv['id']}", timeout=30)

    def test_reservations_writable_by_waiter(self, waiter, admin):
        r = waiter.post(f"{API}/reservations", json={
            "date": TODAY, "time_from": "11:00", "guest_name": "TEST_WaiterRes",
            "guests_count": 1}, timeout=30)
        print("waiter create reservation ->", r.status_code)
        if r.status_code == 200:
            rid = r.json()["id"]
            d = waiter.delete(f"{API}/reservations/{rid}", timeout=30)
            print("waiter delete reservation ->", d.status_code)
            admin.delete(f"{API}/reservations/{rid}", timeout=30)
        assert True  # informational

    def test_empty_refund_creates_zero_record(self, cashier, admin):
        orders = admin.get(f"{API}/orders", timeout=30).json()
        closed = next((o for o in orders if o.get("status") in ("closed", "refunded")), None)
        assert closed, "no closed order available"
        r = cashier.post(f"{API}/orders/{closed['id']}/refund",
                         json={"items": [], "reason": ""}, timeout=30)
        print("empty refund ->", r.status_code, r.json() if r.status_code == 200 else r.text[:200])
        assert r.status_code in (400, 422), (
            "empty refund with no items and no reason accepted (creates a 0 ₽ refund record)")
