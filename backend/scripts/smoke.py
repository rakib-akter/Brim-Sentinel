"""Live smoke test against a running server (default http://127.0.0.1:8000).

  python -m scripts.smoke [base_url]

Runs on a freshly seeded database: Detect → Resolve → Settle → Explain on Cascadia 1625
(BC-009), plus the key denials. Every payment is SIMULATED."""
from __future__ import annotations

import sys

import httpx

B = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
c = httpx.Client(base_url=B, timeout=30)


def call(method: str, path: str, uid: str, expect: int, **kw):  # noqa: ANN003, ANN201
    headers = {"X-Demo-User-Id": uid, **kw.pop("headers", {})}
    r = c.request(method, path, headers=headers, **kw)
    ok = "OK " if r.status_code == expect else "FAIL"
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    note = body.get("error", {}).get("code") if isinstance(body, dict) and "error" in body else ""
    print(f"[{ok}] {method} {path} as {uid} → {r.status_code} {note}")
    if r.status_code != expect:
        print(r.text[:500])
        sys.exit(1)
    return body


inv = call("GET", "/api/v1/invoices/IN-EM-019-1", "U004", 200)
print(f"      Detect: {inv['plain_status']} | primary action: {inv['primary_action']['label']}")
case = next(x for x in inv["resolution_cases"] if x["case_type"] == "BANK_CHANGE_UNVERIFIED")
cd = call("GET", f"/api/v1/cases/{case['id']}", "U004", 200)
contact = cd["bank_change"]["trusted_contacts"][0]["id"]
inv_out = call("POST", f"/api/v1/cases/{case['id']}/investigate", "U004", 200)
print(f"      Investigation ({inv_out['source']}): {inv_out['summary'][:160]}…")
v = {"trusted_contact_id": contact, "method": "phone_callback_to_contact_on_file",
     "occurred_at": "2026-11-03T10:15:00", "outcome": "CONFIRMED",
     "notes": "Called AP contact on file; supplier confirmed account ending 9679.", "evidence_ref": "CALL-LOG-0417"}
call("POST", f"/api/v1/cases/{case['id']}/bank-verification", "U004", 422, json={**v, "evidence_ref": ""})
call("POST", f"/api/v1/cases/{case['id']}/bank-verification", "U005", 403, json=v)
call("POST", f"/api/v1/cases/{case['id']}/bank-verification", "U004", 200, json=v)
call("POST", f"/api/v1/cases/{case['id']}/route-authorization", "U004", 403, json={"notes": "self"})
r = call("POST", f"/api/v1/cases/{case['id']}/route-authorization", "U003", 200,
         json={"notes": "Reviewed callback evidence; authorize EFT route."})
print(f"      Resolve: case {r['state']}, bank change {r['bank_change']['state']}")
inv = call("GET", "/api/v1/invoices/IN-EM-019-1", "U004", 200)
call("POST", f"/api/v1/cases/{case['id']}/authorization-request", "U004", 200,
     json={"expected_invoice_version": inv["version"]})
req = inv["requester_id"]
call("POST", "/api/v1/invoices/IN-EM-019-1/approvals/dept_manager/decision", req, 403,
     json={"expected_version": inv["version"], "decision": "APPROVED"})
call("POST", "/api/v1/invoices/IN-EM-019-1/approvals/dept_manager/decision", "U007", 200,
     json={"expected_version": inv["version"], "decision": "APPROVED"})
p = call("POST", "/api/v1/payments/prepare", "U004", 200, json={"invoice_id": "IN-EM-019-1",
                                                                "expected_version": inv["version"]})
call("POST", f"/api/v1/payments/{p['id']}/release", "U007", 403, headers={"Idempotency-Key": "k0"},
     json={"expected_invoice_version": inv["version"]})
r1 = call("POST", f"/api/v1/payments/{p['id']}/release", "U003", 200, headers={"Idempotency-Key": "k1"},
          json={"expected_invoice_version": inv["version"]})
r2 = call("POST", f"/api/v1/payments/{p['id']}/release", "U003", 200, headers={"Idempotency-Key": "k1"},
          json={"expected_invoice_version": inv["version"]})
assert r2["idempotent_replay"] and r2["id"] == r1["id"]
call("POST", f"/api/v1/payments/{p['id']}/simulate-settlement", "U003", 200, json={"outcome": "SETTLED"})
print(f"      Settle: {r1['label']} — released by {r1['released_by_id']}; replay returned the same payment")
fr = call("GET", "/api/v1/invoices/IN-EM-019-1/flight-recorder", "U006", 200)
print(f"      Explain: {len(fr['events'])} persisted events, "
      f"{sum(1 for e in fr['events'] if e['result'] in ('DENIED', 'BLOCKED'))} blocked attempts recorded")
chain = call("GET", "/api/v1/audit/verify-chain", "U006", 200)
print(f"      Audit hash chain valid: {chain['valid']} ({chain['events_checked']} events)")
print("SMOKE PASSED")
