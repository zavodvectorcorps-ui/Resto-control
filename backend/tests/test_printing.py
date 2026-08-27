"""Iteration 2 — Printing per workshop: printers CRUD, agents, print jobs, agent bridge API."""
import base64

import pytest
import requests

from conftest import API


# ---------- module helpers ----------
def _get_json(sess, path, **kw):
    r = sess.get(f"{API}{path}", timeout=30, **kw)
    return r, (r.json() if r.headers.get("content-type", "").startswith("application/json") else None)


@pytest.fixture(scope="module")
def workshops(admin):
    r = admin.get(f"{API}/workshops", timeout=30)
    assert r.status_code == 200
    return {w["name"]: w["id"] for w in r.json()}


# ---------- Printers CRUD ----------
class TestPrinters:
    def test_seeded_printers_present(self, admin, workshops):
        r = admin.get(f"{API}/printers", timeout=30)
        assert r.status_code == 200
        printers = r.json()
        assert isinstance(printers, list) and len(printers) >= 3
        for p in printers:
            assert "_id" not in p
            assert "id" in p
        stations = {p["station"] for p in printers}
        assert {"kitchen", "bar", "precheck"} <= stations
        kitchen = next(p for p in printers if p["station"] == "kitchen")
        assert kitchen["workshop_id"] == workshops.get("Кухня")
        bar = next(p for p in printers if p["station"] == "bar")
        assert bar["workshop_id"] == workshops.get("Бар")
        assert kitchen["port"] == 9100
        assert kitchen["active"] is True
        assert kitchen["status"] in ("unknown", "online", "offline")

    def test_printer_crud_lifecycle(self, admin, workshops):
        payload = {"name": "TEST_Принтер", "station": "kitchen",
                   "workshop_id": workshops.get("Кухня"), "local_ip": "10.0.0.5",
                   "port": 9101, "codepage_label": "cp1251", "escape_t_value": 6, "paper_width_mm": 58, "active": True}
        r = admin.post(f"{API}/printers", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        created = r.json()
        pid = created["id"]
        assert created["name"] == "TEST_Принтер"
        assert created["local_ip"] == "10.0.0.5"
        assert created["port"] == 9101
        assert created["codepage_label"] == "cp1251"
        assert created["escape_t_value"] == 6
        assert created["status"] == "unknown"

        # GET verify persistence
        lst = admin.get(f"{API}/printers", timeout=30).json()
        got = next((p for p in lst if p["id"] == pid), None)
        assert got is not None and got["name"] == "TEST_Принтер"

        # PATCH
        payload["name"] = "TEST_Принтер2"
        payload["active"] = False
        r = admin.patch(f"{API}/printers/{pid}", json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Принтер2"
        lst = admin.get(f"{API}/printers", timeout=30).json()
        got = next(p for p in lst if p["id"] == pid)
        assert got["name"] == "TEST_Принтер2" and got["active"] is False

        # DELETE
        assert admin.delete(f"{API}/printers/{pid}", timeout=30).status_code == 200
        lst = admin.get(f"{API}/printers", timeout=30).json()
        assert all(p["id"] != pid for p in lst)

    def test_printer_bad_id_returns_404(self, admin):
        r = admin.delete(f"{API}/printers/not-an-oid", timeout=30)
        assert r.status_code == 404, f"expected 404 got {r.status_code}"

    def test_printer_create_requires_admin(self, cashier, workshops):
        r = cashier.post(f"{API}/printers", json={"name": "TEST_bad", "station": "kitchen"}, timeout=30)
        assert r.status_code == 403


# ---------- Agents ----------
class TestAgents:
    def test_seeded_agent_has_key(self, admin):
        r = admin.get(f"{API}/agents", timeout=30)
        assert r.status_code == 200
        agents = r.json()
        assert len(agents) >= 1
        assert all("_id" not in a for a in agents)
        assert isinstance(agents[0]["api_key"], str) and len(agents[0]["api_key"]) >= 32

    def test_create_and_delete_agent(self, admin):
        r = admin.post(f"{API}/agents", json={"name": "TEST_Агент"}, timeout=30)
        assert r.status_code == 200
        a = r.json()
        assert a["name"] == "TEST_Агент"
        assert len(a["api_key"]) == 48
        aid = a["id"]
        lst = admin.get(f"{API}/agents", timeout=30).json()
        assert any(x["id"] == aid for x in lst)
        assert admin.delete(f"{API}/agents/{aid}", timeout=30).status_code == 200
        lst = admin.get(f"{API}/agents", timeout=30).json()
        assert all(x["id"] != aid for x in lst)

    def test_agents_admin_only(self, cashier):
        assert cashier.get(f"{API}/agents", timeout=30).status_code == 403

    def test_agent_bridge_requires_valid_key(self):
        r = requests.get(f"{API}/agent/printers", timeout=30)
        assert r.status_code == 401
        r = requests.get(f"{API}/agent/printers", headers={"X-Agent-Key": "bogus"}, timeout=30)
        assert r.status_code == 401

    def test_agent_bridge_with_key(self, admin):
        key = admin.get(f"{API}/agents", timeout=30).json()[0]["api_key"]
        h = {"X-Agent-Key": key}
        r = requests.get(f"{API}/agent/printers", headers=h, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        r = requests.post(f"{API}/agent/heartbeat", json={"printers": {}}, headers=h, timeout=30)
        assert r.status_code == 200 and r.json()["success"] is True
        agents = admin.get(f"{API}/agents", timeout=30).json()
        assert any(a["last_heartbeat_at"] for a in agents)


# ---------- Print jobs via order send / precheck / void ----------
@pytest.fixture(scope="module")
def shift(cashier):
    r = cashier.post(f"{API}/shifts/open", json={}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="module")
def catalog(admin):
    prods = admin.get(f"{API}/products", timeout=30).json()
    tables = admin.get(f"{API}/tables", timeout=30).json()
    return {"products": prods, "tables": tables}


def _mk_order(sess, catalog, names):
    prods = {p["name"]: p for p in catalog["products"]}
    items = [{"product_id": prods[n]["id"], "name": n, "price": prods[n]["price"],
              "count": 1, "workshop_id": prods[n].get("workshop_id")} for n in names]
    r = sess.post(f"{API}/orders", json={"table_id": catalog["tables"][-1]["id"], "items": items}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    return r.json()


class TestPrintJobs:
    def test_send_creates_ticket_jobs_grouped_by_workshop(self, cashier, admin, shift, catalog):
        o = _mk_order(cashier, catalog, ["Классический бургер", "Латте"])
        r = cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert {t["workshop"] for t in data["tickets"]} == {"Кухня", "Бар"}
        assert len(data["jobs"]) == 2, f"expected 2 jobs (kitchen+bar) got {data['jobs']}"
        for j in data["jobs"]:
            assert j["type"] == "ticket"
            assert j["status"] == "pending"
            assert "_id" not in j
            assert "*** ЗАКАЗ ***" in j["text"]
            decoded = base64.b64decode(j["payload"])
            assert decoded.startswith(b"\x1b@")
            assert decoded.endswith(b"\x1dV\x00")

        # order items marked printed
        got = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        assert got["status"] == "sent"
        assert all(it["print_status"] == "printed" for it in got["items"])
        assert all(it.get("print_job_id") for it in got["items"])

        # admin queue shows the jobs
        jobs = admin.get(f"{API}/print-jobs", timeout=30).json()
        ids = {j["id"] for j in jobs}
        assert all(j["id"] in ids for j in data["jobs"])
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_delta_send_only_new_items(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Кола 0.5л"])
        r1 = cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30)
        assert r1.status_code == 200
        assert len(r1.json()["jobs"]) == 1
        # add a new pending line
        cur = cashier.get(f"{API}/orders/{o['id']}", timeout=30).json()
        prods = {p["name"]: p for p in catalog["products"]}
        p = prods["Цезарь"]
        items = cur["items"] + [{"product_id": p["id"], "name": p["name"], "price": p["price"],
                                 "count": 1, "workshop_id": p["workshop_id"], "print_status": "pending"}]
        assert cashier.put(f"{API}/orders/{o['id']}", json={"items": items}, timeout=30).status_code == 200
        r2 = cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        assert [t["workshop"] for t in d2["tickets"]] == ["Кухня"], d2["tickets"]
        assert len(d2["jobs"]) == 1
        assert "Цезарь" in d2["jobs"][0]["text"] and "Кола" not in d2["jobs"][0]["text"]
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_request_bill_creates_precheck_job(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Чизбургер", "Кола 0.5л"])
        r = cashier.post(f"{API}/orders/{o['id']}/request-bill", json={}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        job = r.json()["job"]
        assert job["type"] == "precheck"
        assert job["station"] == "precheck"
        assert "--- ПРЕДЧЕК ---" in job["text"]
        assert "ИТОГО:" in job["text"]
        assert f"{o['subtotal']:.2f}" in job["text"]
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_void_printed_item_creates_void_job(self, cashier, shift, catalog):
        o = _mk_order(cashier, catalog, ["Классический бургер", "Латте"])
        cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30)
        r = cashier.request("DELETE", f"{API}/orders/{o['id']}/items/0",
                            json={"reason": "TEST_сторно"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["void_job"] is not None, "printed item removal must create a СТОРНО job"
        assert d["void_job"]["type"] == "void"
        assert "*** СТОРНО ***" in d["void_job"]["text"]
        assert "Классический бургер" in d["void_job"]["text"]
        assert len(d["order"]["items"]) == 1
        assert d["order"]["items"][0]["name"] == "Латте"
        assert d["order"]["subtotal"] == d["order"]["items"][0]["total"]
        # out of range index
        assert cashier.delete(f"{API}/orders/{o['id']}/items/9", timeout=30).status_code == 404
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_emulator_prints_pending_jobs(self, cashier, admin, shift, catalog):
        o = _mk_order(cashier, catalog, ["Греческий салат"])
        send = cashier.post(f"{API}/orders/{o['id']}/send", json={}, timeout=30).json()
        jid = send["jobs"][0]["id"]
        r = admin.post(f"{API}/agent/emulate", json={}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["processed"] >= 1
        assert all(j["status"] == "printed" for j in d["jobs"])
        jobs = {j["id"]: j for j in admin.get(f"{API}/print-jobs", timeout=30).json()}
        assert jobs[jid]["status"] == "printed"
        assert jobs[jid]["printed_at"]
        assert jobs[jid]["attempts"] >= 1
        printers = admin.get(f"{API}/printers", timeout=30).json()
        assert all(p["status"] == "online" for p in printers)
        cashier.delete(f"{API}/orders/{o['id']}", timeout=30)

    def test_emulate_admin_only(self, cashier):
        assert cashier.post(f"{API}/agent/emulate", json={}, timeout=30).status_code == 403

    def test_retry_resets_job_to_pending(self, admin):
        jobs = admin.get(f"{API}/print-jobs", timeout=30).json()
        printed = next((j for j in jobs if j["status"] == "printed"), None)
        if not printed:
            pytest.skip("no printed job to retry")
        r = admin.post(f"{API}/print-jobs/{printed['id']}/retry", json={}, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        assert r.json()["printed_at"] is None
        # agent fetch claims it -> sent
        key = admin.get(f"{API}/agents", timeout=30).json()[0]["api_key"]
        fetched = requests.get(f"{API}/agent/print-jobs", headers={"X-Agent-Key": key}, timeout=30)
        assert fetched.status_code == 200
        assert any(j["id"] == printed["id"] for j in fetched.json())
        rep = requests.patch(f"{API}/agent/print-jobs/{printed['id']}",
                             json={"status": "printed"}, headers={"X-Agent-Key": key}, timeout=30)
        assert rep.status_code == 200
        after = {j["id"]: j for j in admin.get(f"{API}/print-jobs", timeout=30).json()}
        assert after[printed["id"]]["status"] == "printed"

    def test_retry_bad_id(self, admin):
        assert admin.post(f"{API}/print-jobs/zzz/retry", json={}, timeout=30).status_code == 404

    def test_print_jobs_admin_only(self, cashier):
        assert cashier.get(f"{API}/print-jobs", timeout=30).status_code == 403
