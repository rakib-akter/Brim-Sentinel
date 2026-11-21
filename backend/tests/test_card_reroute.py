"""AT-12 / AT-44 / PRD §6.2: EFT → simulated Brim virtual-card rerouting with two-person controls,
plus the threshold-splitting control. Everything is SIMULATED; no AI identity can act."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from app.db.models import AuditEvent
from tests.conftest import H, codes, finding, inv

PAPER_TRAIL = "IN-EM-024-1"  # V024 Paper Trail Office Supply: EFT remit, vendor accepts card
CASCADIA = "IN-EM-019-1"  # V004: does not accept card
NOW = dt.datetime.now().replace(microsecond=0).isoformat()


def _bank_change(client, vendor="V024"):
    r = client.post(f"/api/v1/vendors/{vendor}/bank-change-requests", headers=H("U004"),
                    json={"institution": "001", "transit": "12345", "account": "987654321",
                          "request_channel": "email_request", "evidence_ref": "EMAIL-7781"})
    assert r.status_code == 200, r.text
    return r.json()


def _register(client, uid="U004", vendor="V024"):
    return client.post(f"/api/v1/vendors/{vendor}/card-routes", headers=H(uid),
                       json={"merchant_reference": "PTOS-MRCH-4471", "evidence_ref": "VENDOR-LETTER-22",
                             "notes": "Merchant reference from the supplier's signed card-acceptance letter."})


def _verify(client, route_id, uid="U005", **over):
    body = {"trusted_contact_id": "VC-V024-EMAIL", "method": "phone_callback_to_contact_on_file",
            "occurred_at": NOW, "outcome": "CONFIRMED", "evidence_ref": "CALL-LOG-9001",
            "notes": "Called AP contact on file; supplier confirmed the virtual-card merchant reference."}
    body.update(over)
    return client.post(f"/api/v1/vendors/card-routes/{route_id}/verification", headers=H(uid), json=body)


def _request(client, iid=PAPER_TRAIL, uid="U004"):
    d = inv(client, iid)
    return client.post(f"/api/v1/invoices/{iid}/payment-method-changes", headers=H(uid),
                       json={"expected_version": d["version"], "to_method": "CARD",
                             "reason": "EFT account change is unverified; pay through verified virtual card."})


def _decide(client, change_id, uid, decision="AUTHORIZED", iid=PAPER_TRAIL):
    return client.post(f"/api/v1/invoices/{iid}/payment-method-changes/{change_id}/decision", headers=H(uid),
                       json={"decision": decision, "notes": "Route provenance and callback evidence reviewed."})


def _verified_route(client):
    route = _register(client).json()
    assert _verify(client, route["id"]).status_code == 200
    return route


def test_card_route_registration_and_independent_verification(client):
    assert _register(client, vendor="V004").json()["error"]["code"] == "VENDOR_DOES_NOT_ACCEPT_CARD"
    assert _register(client, uid="SVC-SENTINEL").status_code == 403  # AI identity
    assert _register(client, uid="U007").status_code == 403  # department approver
    r = _register(client)
    assert r.status_code == 200, r.text
    route = r.json()
    assert route["status"] == "UNVERIFIED" and route["simulated"] and route["merchant_reference_masked"] == "****4471"
    bad = client.post("/api/v1/vendors/V024/card-routes", headers=H("U004"),
                      json={"merchant_reference": "PAPER TRAIL OFFICE SUP", "evidence_ref": "x1x",
                            "notes": "copied from card descriptor"})
    assert bad.status_code == 422  # descriptors are not merchant references
    r = _verify(client, route["id"], uid="U004")
    assert r.status_code == 403 and r.json()["error"]["code"] == "VERIFIER_NOT_INDEPENDENT"
    assert _verify(client, route["id"], uid="SVC-SENTINEL").status_code == 403
    assert _verify(client, route["id"], trusted_contact_id="VC-FAKE").json()["error"]["code"] == "TRUSTED_CONTACT_INVALID"
    assert _verify(client, route["id"], evidence_ref="").json()["error"]["code"] == "EVIDENCE_REQUIRED"
    assert _verify(client, route["id"], verified=True).status_code == 422  # unknown field
    r = _verify(client, route["id"])
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "VERIFIED" and r.json()["verified_by"] == "U005"
    assert "independently verified by U005" in r.json()["provenance"]
    assert _verify(client, route["id"]).status_code == 409  # cannot re-verify


def test_full_eft_to_card_reroute_with_segregation_of_duties(client, session):
    _bank_change(client)
    d = inv(client, PAPER_TRAIL)
    assert d["lifecycle_state"] == "ON_HOLD" and "BANK_CHANGE_UNVERIFIED" in codes(d)
    # AT-44: no verified card route → the request is refused, hold remains.
    r = _request(client)
    assert r.status_code == 422 and "VERIFIED_CARD_ROUTE_UNAVAILABLE" in r.json()["error"]["details"]["failed_gates"]
    route = _verified_route(client)

    r = _request(client)
    assert r.status_code == 200, r.text
    pmc = r.json()
    assert pmc["state"] == "REQUESTED" and pmc["route_id"] == route["id"] and pmc["from_method"] == "EFT"
    assert pmc["supporting_card_history"]["matches"] >= 1  # supporting evidence, not proof
    assert "not establish" in pmc["supporting_card_history"]["note"] or "never" in pmc["supporting_card_history"]["note"]
    assert _request(client).status_code == 409  # one open request per version
    assert inv(client, PAPER_TRAIL)["lifecycle_state"] == "ON_HOLD"  # a request authorizes nothing

    # Only a finance manager, independent of requester / route registrant / verifier, may authorize.
    for uid, status in (("U004", 403), ("U005", 403), ("U002", 403), ("U011", 403), ("SVC-SENTINEL", 403)):
        assert _decide(client, pmc["id"], uid).status_code == status, uid
    r = _decide(client, pmc["id"], "U003")
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "AUTHORIZED" and r.json()["decided_by"] == "U003"

    d = inv(client, PAPER_TRAIL)
    assert d["lifecycle_state"] == "PENDING_APPROVAL"
    bc = finding(d, "BANK_CHANGE_UNVERIFIED")
    assert not bc["blocking"] and pmc["id"] in bc["rationale"]  # EFT still blocked, shown for audit
    assert finding(d, "PAYMENT_ROUTE")["data"]["method"] == "CARD"

    # Method change ≠ approval: approvals still required; EFT cannot be used for this version.
    assert client.post("/api/v1/payments/prepare", headers=H("U004"),
                       json={"invoice_id": PAPER_TRAIL, "expected_version": d["version"]}).status_code == 409
    r = client.post(f"/api/v1/invoices/{PAPER_TRAIL}/approvals/dept_manager/decision", headers=H("U011"),
                    json={"expected_version": d["version"], "decision": "APPROVED"})
    assert r.status_code == 200 and r.json()["lifecycle_state"] == "APPROVED"
    r = client.post("/api/v1/payments/prepare", headers=H("U004"),
                    json={"invoice_id": PAPER_TRAIL, "expected_version": d["version"], "method": "EFT"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "METHOD_CHANGE_REQUIRES_CARD"
    r = client.post("/api/v1/payments/prepare", headers=H("U004"),
                    json={"invoice_id": PAPER_TRAIL, "expected_version": d["version"]})
    assert r.status_code == 200, r.text
    pay = r.json()
    assert pay["method"] == "CARD" and pay["route_id"] == route["id"]

    rel = f"/api/v1/payments/{pay['id']}/release"
    r = client.post(rel, headers=H("U003", **{"Idempotency-Key": "pt-1"}), json={"expected_invoice_version": d["version"]})
    assert r.status_code == 403 and r.json()["error"]["code"] == "METHOD_CHANGE_PARTY_CANNOT_RELEASE"
    r = client.post(rel, headers=H("U002", **{"Idempotency-Key": "pt-2"}), json={"expected_invoice_version": d["version"]})
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "RELEASED" and r.json()["reference"].startswith("SIMULATED-CARD-")

    acts = [e.action for e in session.scalars(select(AuditEvent).where(AuditEvent.invoice_id == PAPER_TRAIL))]
    for a in ("payment_method.change_requested", "payment_method.change_authorized", "payment.released"):
        assert a in acts
    route_events = [e.action for e in session.scalars(select(AuditEvent).where(AuditEvent.object_id == route["id"]))]
    assert route_events == ["card_route.registered", "card_route.verification_recorded"]


def test_material_edit_supersedes_method_change_and_restores_hold(client):
    _bank_change(client)
    _verified_route(client)
    pmc = _request(client).json()
    assert _decide(client, pmc["id"], "U003").status_code == 200
    d = inv(client, PAPER_TRAIL)
    assert d["lifecycle_state"] == "PENDING_APPROVAL"
    r = client.patch(f"/api/v1/invoices/{PAPER_TRAIL}/fields", headers=H("U004"),
                     json={"expected_version": d["version"], "reason": "Corrected due date per supplier",
                           "fields": {"due_date": "2026-12-15"}})
    assert r.status_code == 200, r.text
    assert r.json()["lifecycle_state"] == "ON_HOLD" and "BANK_CHANGE_UNVERIFIED" in codes(r.json())
    changes = client.get(f"/api/v1/invoices/{PAPER_TRAIL}/payment-method-changes", headers=H("U004")).json()
    assert changes[0]["state"] == "SUPERSEDED" and changes[0]["applies_to_current_version"] is False


def test_declined_method_change_keeps_hold_and_unauthorized_card_is_refused(client):
    _bank_change(client)
    _verified_route(client)
    pmc = _request(client).json()
    r = _decide(client, pmc["id"], "U003", decision="DECLINED")
    assert r.status_code == 200 and r.json()["state"] == "DECLINED"
    d = inv(client, PAPER_TRAIL)
    assert d["lifecycle_state"] == "ON_HOLD" and "BANK_CHANGE_UNVERIFIED" in codes(d)
    assert _decide(client, pmc["id"], "U003").status_code == 409


def test_method_change_requires_card_acceptance(client):
    d = inv(client, CASCADIA)
    r = client.post(f"/api/v1/invoices/{CASCADIA}/payment-method-changes", headers=H("U004"),
                    json={"expected_version": d["version"], "to_method": "CARD", "reason": "Try the card instead."})
    assert r.status_code == 422
    assert "VENDOR_DOES_NOT_ACCEPT_CARD" in r.json()["error"]["details"]["failed_gates"]
    assert inv(client, CASCADIA)["lifecycle_state"] == "ON_HOLD"


# ----------------------------------------------------------------------------- split billing
ORION = ("IN-EM-029-1", "IN-EM-029-2", "IN-EM-030-1")  # "Network audit phase 1/2/3", each < CAD 10k


def test_split_billing_held_for_finance_review(client):
    flagged = []
    for iid in ORION:
        d = inv(client, iid)
        assert d["lifecycle_state"] == "ON_HOLD" and "SPLIT_BILLING_SUSPECTED" in codes(d), iid
        f = finding(d, "SPLIT_BILLING_SUSPECTED")
        assert f["data"]["combined_cad_minor"] == 1454310 and set(f["data"]["related_invoices"]) == set(ORION) - {iid}
        flagged.append(iid)
    allinv = client.get("/api/v1/invoices?limit=500", headers=H("U004")).json()["items"]
    held = [i["id"] for i in allinv if any(r.startswith("SPLIT_BILLING") for r in i["blocked_reasons"])
            or "SPLIT_BILLING_SUSPECTED" in codes(inv(client, i["id"]))]
    assert sorted(held) == sorted(flagged)  # routine recurring freight billing is not flagged

    d = inv(client, ORION[0])
    f = finding(d, "SPLIT_BILLING_SUSPECTED")
    url = f"/api/v1/invoices/{ORION[0]}/findings/{f['id']}/dismiss"
    assert client.post(url, headers=H("U004"), json={"expected_version": d["version"],
                                                     "reason": "separate phases"}).status_code == 403
    r = client.post(url, headers=H("U003"), json={"expected_version": d["version"],
                                                  "reason": "Separate SOW phases signed on different dates; reviewed."})
    assert r.status_code == 200 and r.json()["lifecycle_state"] == "PENDING_APPROVAL"
    assert inv(client, ORION[1])["lifecycle_state"] == "ON_HOLD"  # each bill is reviewed on its own
