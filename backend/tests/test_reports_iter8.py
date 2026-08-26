"""Task 5 — Advanced Analytics / Reports endpoints."""
import pytest
import requests

from conftest import API


# --- module: reports / sales ---
class TestSalesReport:
    def test_sales_ok(self, admin):
        r = admin.get(f"{API}/reports/sales", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["total", "cash", "card", "orders", "by_product", "by_cashier"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["by_product"], list)
        assert isinstance(d["orders"], int)
        # cash+card should not exceed total materially
        assert round(d["cash"] + d["card"], 2) <= round(d["total"], 2) + 0.01

    def test_sales_requires_manager(self, waiter, cashier):
        assert waiter.get(f"{API}/reports/sales", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/sales", timeout=30).status_code == 403

    def test_sales_no_auth(self):
        r = requests.get(f"{API}/reports/sales", timeout=30)
        assert r.status_code in (401, 403), r.status_code


# --- module: reports / analytics ---
class TestAnalytics:
    def test_analytics_shape(self, admin):
        r = admin.get(f"{API}/reports/analytics", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["total", "orders", "avg_check", "by_hour", "margin_by_product"]:
            assert k in d
        assert len(d["by_hour"]) == 24, f"by_hour len={len(d['by_hour'])}"
        assert [h["hour"] for h in d["by_hour"]] == [f"{i:02d}" for i in range(24)]
        # avg check consistency
        if d["orders"]:
            assert abs(d["avg_check"] - round(d["total"] / d["orders"], 2)) < 0.02
        assert d["margin_by_product"], "margin_by_product empty — seed has closed orders?"
        row = d["margin_by_product"][0]
        for k in ["name", "qty", "revenue", "cost", "margin", "margin_pct"]:
            assert k in row
        assert abs(row["margin"] - round(row["revenue"] - row["cost"], 2)) < 0.02
        # by_hour sums to total
        assert abs(sum(h["revenue"] for h in d["by_hour"]) - d["total"]) < 1.0

    def test_analytics_403(self, waiter, cashier):
        assert waiter.get(f"{API}/reports/analytics", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/analytics", timeout=30).status_code == 403

    def test_analytics_date_filter_empty_range(self, admin):
        r = admin.get(f"{API}/reports/analytics", params={"start": "1990-01-01", "end": "1990-01-02"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["orders"] == 0 and d["total"] == 0
        assert d["avg_check"] == 0
        assert len(d["by_hour"]) == 24


# --- module: reports / by-category (new) ---
class TestByCategory:
    def test_by_category(self, admin):
        r = admin.get(f"{API}/reports/by-category", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "rows" in d and "total" in d
        assert d["rows"], "no category rows"
        revs = [x["revenue"] for x in d["rows"]]
        assert revs == sorted(revs, reverse=True), "rows not sorted desc by revenue"
        assert abs(sum(revs) - d["total"]) < 0.05
        for row in d["rows"]:
            assert set(["name", "count", "revenue"]).issubset(row)
            assert isinstance(row["name"], str) and row["name"]
        # data quality: category names should be resolved, not all "Без категории"
        assert not all(x["name"] == "Без категории" for x in d["rows"]), \
            "all rows uncategorized — product_id/category mapping broken"

    def test_by_category_403(self, waiter, cashier):
        assert waiter.get(f"{API}/reports/by-category", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/by-category", timeout=30).status_code == 403

    def test_by_category_date_filter(self, admin):
        full = admin.get(f"{API}/reports/by-category", timeout=30).json()
        empty = admin.get(f"{API}/reports/by-category",
                          params={"start": "1990-01-01", "end": "1990-01-02"}, timeout=30).json()
        assert empty["rows"] == [] and empty["total"] == 0
        assert full["total"] >= empty["total"]


# --- module: reports / by-workshop (new) ---
class TestByWorkshop:
    def test_by_workshop(self, admin):
        r = admin.get(f"{API}/reports/by-workshop", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["rows"], "no workshop rows"
        revs = [x["revenue"] for x in d["rows"]]
        assert revs == sorted(revs, reverse=True)
        assert abs(sum(revs) - d["total"]) < 0.05
        names = [x["name"] for x in d["rows"]]
        assert not all(n == "Без цеха" for n in names), f"workshop names unresolved: {names}"

    def test_by_workshop_matches_category_total(self, admin):
        cat = admin.get(f"{API}/reports/by-category", timeout=30).json()
        ws = admin.get(f"{API}/reports/by-workshop", timeout=30).json()
        assert abs(cat["total"] - ws["total"]) < 0.05, \
            f"category total {cat['total']} != workshop total {ws['total']}"

    def test_by_workshop_403(self, waiter, cashier):
        assert waiter.get(f"{API}/reports/by-workshop", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/by-workshop", timeout=30).status_code == 403


# --- module: reports / abc (new) ---
class TestABC:
    @pytest.mark.parametrize("metric", ["revenue", "count"])
    def test_abc(self, admin, metric):
        r = admin.get(f"{API}/reports/abc", params={"metric": metric}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["metric"] == metric
        assert d["rows"], "abc rows empty"
        prev = 0
        for row in d["rows"]:
            for k in ["name", "count", "revenue", "cum_pct", "abc"]:
                assert k in row, f"missing {k}"
            assert row["abc"] in ("A", "B", "C")
            assert row["cum_pct"] >= prev - 0.11, "cum_pct must be non-decreasing"
            prev = row["cum_pct"]
        assert abs(d["rows"][-1]["cum_pct"] - 100.0) < 0.5, \
            f"last cum_pct should be ~100, got {d['rows'][-1]['cum_pct']}"
        # sorted desc by chosen metric
        vals = [row[metric] for row in d["rows"]]
        assert vals == sorted(vals, reverse=True)
        # classes monotone A then B then C
        order = {"A": 0, "B": 1, "C": 2}
        cls = [order[row["abc"]] for row in d["rows"]]
        assert cls == sorted(cls), "ABC classes not monotone"

    def test_abc_default_metric(self, admin):
        d = admin.get(f"{API}/reports/abc", timeout=30).json()
        assert d["metric"] == "revenue"

    def test_abc_invalid_metric_falls_back(self, admin):
        r = admin.get(f"{API}/reports/abc", params={"metric": "bogus"}, timeout=30)
        assert r.status_code in (200, 422), r.text[:200]

    def test_abc_403(self, waiter, cashier):
        assert waiter.get(f"{API}/reports/abc", timeout=30).status_code == 403
        assert cashier.get(f"{API}/reports/abc", timeout=30).status_code == 403

    def test_abc_empty_range(self, admin):
        d = admin.get(f"{API}/reports/abc",
                      params={"start": "1990-01-01", "end": "1990-01-02"}, timeout=30).json()
        assert d["rows"] == []


# --- module: reports / corrections ---
class TestCorrections:
    def test_corrections(self, admin):
        r = admin.get(f"{API}/reports/corrections", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert isinstance(d, list)
        for c in d[:5]:
            assert "_id" not in c, "MongoDB _id leaked in response"

    def test_corrections_403(self, waiter):
        assert waiter.get(f"{API}/reports/corrections", timeout=30).status_code == 403


# --- cross-check: abc revenue total vs sales total ---
def test_abc_total_matches_sales(admin):
    abc = admin.get(f"{API}/reports/abc", timeout=30).json()
    sales = admin.get(f"{API}/reports/sales", timeout=30).json()
    prod_total = round(sum(p["revenue"] for p in sales["by_product"]), 2)
    assert abs(abc["total"] - prod_total) < 0.05, f"{abc['total']} vs {prod_total}"
