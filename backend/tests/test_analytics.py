"""Analytics are aggregates of stored records, scoped like invoice visibility. Expected values are
computed independently from the dataset CSVs (paid invoices, CAD at the invoice-date rate)."""
from tests.conftest import H

URL = "/api/v1/analytics"


def _row(rows, key):
    return next(r for r in rows if r["key"] == key)


def test_finance_sees_company_spend_matching_the_ledger(client):
    r = client.get(URL, headers=H("U004"))
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["scope"] == "all"
    assert a["kpis"]["paid_invoices"] == 394
    assert a["kpis"]["spend_cad_minor"] == 196_277_914  # CAD 1,962,779.14 from invoices.csv
    assert [m["key"] for m in a["spend_by_month"]] == [f"2026-{n:02d}" for n in range(1, 11)]
    assert sum(m["cad_minor"] for m in a["spend_by_month"]) == a["kpis"]["spend_cad_minor"]
    assert sum(d["cad_minor"] for d in a["spend_by_department"]) == a["kpis"]["spend_cad_minor"]
    assert sum(v["cad_minor"] for v in a["spend_by_vendor"]) == a["kpis"]["spend_cad_minor"]
    assert a["spend_by_vendor"][0]["key"] == "V036" and a["spend_by_vendor"][-1]["key"] == "other"
    assert a["spend_by_department"][0]["key"] == "D07"
    assert {m["key"]: m["count"] for m in a["payment_methods"]} == {"EFT": 326, "CARD": 67, "CHEQUE": 22}


def test_workflow_breakdowns_are_consistent(client):
    a = client.get(URL, headers=H("U004")).json()
    k = a["kpis"]
    assert sum(s["count"] for s in a["processing_status"]) == k["in_workflow"] > 0
    assert _row(a["processing_status"], "ON_HOLD")["count"] == k["on_hold"]
    assert _row(a["processing_status"], "PENDING_APPROVAL")["count"] == k["waiting_for_approval"]
    hold = _row(a["hold_reasons"], "BANK_CHANGE_UNVERIFIED")
    assert hold["count"] >= 2 and hold["label"] != hold["key"]  # plain title from the catalog
    workload = {w["key"]: w for w in a["approval_workload"]}
    assert "U007" in workload and workload["U007"]["label"] == "Dev Malhotra"


def test_department_approver_sees_only_their_department(client):
    a = client.get(URL, headers=H("U007")).json()  # Operations (D01)
    assert a["scope"] == "department"
    assert a["kpis"]["paid_invoices"] == 133 and a["kpis"]["spend_cad_minor"] == 63_557_516
    assert [d["key"] for d in a["spend_by_department"]] == ["D01"]


def test_requester_sees_only_their_own_invoices(client):
    mine = client.get(URL, headers=H("U013")).json()
    everyone = client.get(URL, headers=H("U004")).json()
    assert mine["scope"] == "own"
    assert mine["kpis"]["spend_cad_minor"] < everyone["kpis"]["spend_cad_minor"]
