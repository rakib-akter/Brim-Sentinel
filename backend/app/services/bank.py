"""VendorVerificationService (FR-09, wizard steps 2–3): bank-change state machine.

REQUESTED → PENDING_INDEPENDENT_VERIFICATION → VERIFICATION_RECORDED → PENDING_ROUTE_AUTHORIZATION
→ AUTHORIZED → REVALIDATION_REQUIRED → CLOSED   (or → REJECTED if the callback denies the change)

Verification requires a trusted contact that existed on file BEFORE the change request, an
authorized verifier independent of whoever entered the change, method/time/notes and an evidence
reference. A checkbox or note alone never verifies. Route authorization is a separate person."""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, Forbidden, NotFound, Unprocessable
from app.core.permissions import require
from app.db.models import (
    Invoice,
    PaymentRoute,
    ResolutionCase,
    User,
    Vendor,
    VendorBankChange,
    VendorContact,
)
from app.db.seed import account_fingerprint
from app.services import audit, lifecycle as lc, pipeline

VERIFY_METHODS = {"phone_callback_to_contact_on_file", "video_call_to_contact_on_file", "in_person_meeting"}


def get_change(session: Session, change_id: str) -> VendorBankChange:
    bc = session.get(VendorBankChange, change_id)
    if bc is None:
        raise NotFound("BANK_CHANGE_NOT_FOUND", f"Bank change {change_id} not found.")
    return bc


def _check_row(bc: VendorBankChange, expected: int | None) -> None:
    if expected is not None and expected != bc.row_version:
        raise Conflict("BANK_CHANGE_VERSION_CONFLICT", "This bank change was updated. Refresh before continuing.",
                       {"expected": expected, "current": bc.row_version})


def trusted_contacts(session: Session, bc: VendorBankChange) -> list[VendorContact]:
    return [c for c in session.scalars(select(VendorContact).where(VendorContact.vendor_id == bc.vendor_id))
            if c.source == "vendor_master" and c.established_at < bc.requested_at]


def _set_state(session: Session, bc: VendorBankChange, actor: User | None, new: str, **details: Any) -> None:
    old = bc.state
    bc.state = new
    bc.row_version += 1
    audit.record(session, actor=actor, action="bank_change.transition", object_type="bank_change", object_id=bc.id,
                 before=old, after=new, details=details)


def _cases_for(session: Session, bc: VendorBankChange) -> list[ResolutionCase]:
    return list(session.scalars(select(ResolutionCase).where(ResolutionCase.bank_change_id == bc.id,
                                                             ResolutionCase.state.not_in({"RESOLVED", "REJECTED", "CANCELLED"}))))


def _revalidate_vendor_invoices(session: Session, vendor_id: str, actor: User | None, reason: str) -> list[str]:
    ids = []
    for inv in session.scalars(select(Invoice).where(Invoice.vendor_id == vendor_id,
                                                     Invoice.source_kind != "historical_ledger",
                                                     Invoice.lifecycle_state.in_(lc.REVALIDATABLE))):
        pipeline.process(session, inv, actor=actor, reason=reason)
        ids.append(inv.id)
    return ids


def request_change(session: Session, actor: User, vendor: Vendor, *, institution: str, transit: str, account: str,
                   request_channel: str, evidence_ref: str | None) -> VendorBankChange:
    require(actor, "bank_change.request")
    if not (institution.isdigit() and transit.isdigit() and account.isdigit()
            and len(institution) == 3 and len(transit) == 5 and 5 <= len(account) <= 12):
        raise Unprocessable("BANK_DETAILS_INVALID", "Institution (3 digits), transit (5 digits) and account "
                            "(5–12 digits) are required.")
    n = (session.scalar(select(func.count()).select_from(VendorBankChange)) or 0) + 1
    route = PaymentRoute(id=f"RT-{vendor.id}-EFT-{n:03d}", vendor_id=vendor.id, method="EFT",
                         account_last4=account[-4:], account_fingerprint=account_fingerprint(institution, transit, account),
                         status="UNVERIFIED", provenance=f"bank change request via {request_channel} by {actor.id}",
                         verified_at=None, bank_change_id=f"BC-APP-{n:03d}")
    bc = VendorBankChange(id=f"BC-APP-{n:03d}", vendor_id=vendor.id, requested_at=dt.date.today().isoformat(),
                          requested_by_user_id=actor.id, request_channel=request_channel,
                          old_account_last4=(vendor.bank_account or "")[-4:] or None, new_account_last4=account[-4:],
                          new_route_id=route.id, state="REQUESTED", source="app")
    session.add_all([route, bc])
    session.flush()
    audit.record(session, actor=actor, action="bank_change.requested", object_type="bank_change", object_id=bc.id,
                 after="REQUESTED", details={"vendor_id": vendor.id, "channel": request_channel,
                                             "new_last4": account[-4:], "evidence_ref": evidence_ref,
                                             "note": "Vendor master NOT changed; route UNVERIFIED."})
    _set_state(session, bc, actor, "PENDING_INDEPENDENT_VERIFICATION")
    _revalidate_vendor_invoices(session, vendor.id, actor, f"bank change {bc.id} requested")
    return bc


def record_verification(session: Session, actor: User, bc: VendorBankChange, *, trusted_contact_id: str | None,
                        method: str, occurred_at: str, outcome: str, notes: str, evidence_ref: str,
                        expected_row_version: int | None) -> VendorBankChange:
    require(actor, "bank_change.verify")
    _check_row(bc, expected_row_version)
    if bc.state != "PENDING_INDEPENDENT_VERIFICATION":
        raise Conflict("INVALID_TRANSITION", f"Bank change is {bc.state}; verification already recorded or closed.")
    if actor.id == bc.requested_by_user_id:
        raise Forbidden("VERIFIER_NOT_INDEPENDENT", "The person who entered the bank change cannot verify it.")
    contacts = {c.id: c for c in trusted_contacts(session, bc)}
    if not contacts:
        raise Unprocessable("TRUSTED_CONTACT_MISSING", "No trusted contact was on file before this change request. "
                            "Verification cannot proceed; the payment stays held.")
    if not trusted_contact_id or trusted_contact_id not in contacts:
        raise Unprocessable("TRUSTED_CONTACT_INVALID", "Verification must use a contact that was on file before the "
                            "change request (not one supplied with the request).",
                            {"trusted_contact_ids": sorted(contacts)})
    if method not in VERIFY_METHODS:
        raise Unprocessable("VERIFICATION_METHOD_INVALID", "Unsupported verification method.",
                            {"allowed": sorted(VERIFY_METHODS)})
    if outcome not in {"CONFIRMED", "DENIED"}:
        raise Unprocessable("OUTCOME_INVALID", "outcome must be CONFIRMED or DENIED.")
    if not evidence_ref or len(evidence_ref.strip()) < 3:
        raise Unprocessable("EVIDENCE_REQUIRED", "An evidence reference (e.g. call log ID) is required. Notes or a "
                            "checkbox alone are not verification.")
    if not notes or len(notes.strip()) < 10:
        raise Unprocessable("NOTES_REQUIRED", "Describe what was confirmed (≥ 10 characters).")
    try:
        when = dt.datetime.fromisoformat(occurred_at)
    except ValueError as e:
        raise Unprocessable("OCCURRED_AT_INVALID", "occurred_at must be an ISO datetime.") from e
    if when.date().isoformat() < bc.requested_at:
        raise Unprocessable("OCCURRED_AT_INVALID", "Verification cannot pre-date the change request.")
    bc.verifier_id = actor.id
    bc.trusted_contact_id = trusted_contact_id
    bc.verification_method = method
    bc.verification_occurred_at = occurred_at
    bc.verification_notes = notes
    bc.verification_evidence_ref = evidence_ref
    bc.verification_outcome = outcome
    audit.record(session, actor=actor, action="bank_change.verification_recorded", object_type="bank_change",
                 object_id=bc.id, evidence=[{"type": "verification_evidence", "ref": evidence_ref},
                                            {"type": "vendor_contact", "ref": trusted_contact_id}],
                 details={"method": method, "occurred_at": occurred_at, "outcome": outcome, "notes": notes,
                          "contact_established_at": contacts[trusted_contact_id].established_at})
    if outcome == "DENIED":
        _set_state(session, bc, actor, "REJECTED", reason="supplier denied the change on trusted callback")
        route = session.get(PaymentRoute, bc.new_route_id) if bc.new_route_id else None
        if route is not None:
            route.status = "REVOKED"
        for c in _cases_for(session, bc):
            c.state = "INVESTIGATING"
            c.row_version += 1
        return bc
    _set_state(session, bc, actor, "VERIFICATION_RECORDED")
    _set_state(session, bc, actor, "PENDING_ROUTE_AUTHORIZATION")
    for c in _cases_for(session, bc):
        c.state = "AWAITING_AUTHORIZATION"
        c.row_version += 1
    return bc


def authorize_route(session: Session, actor: User, bc: VendorBankChange, *, notes: str,
                    expected_row_version: int | None) -> VendorBankChange:
    require(actor, "bank_change.authorize")
    _check_row(bc, expected_row_version)
    if bc.state != "PENDING_ROUTE_AUTHORIZATION":
        raise Conflict("INVALID_TRANSITION", f"Bank change is {bc.state}; independent verification must be recorded "
                       "first.", {"state": bc.state})
    if actor.id in {bc.verifier_id, bc.requested_by_user_id}:
        raise Forbidden("TWO_PERSON_CONTROL", "Route authorization must be done by someone other than the verifier "
                        "and the person who entered the change.")
    if not notes or len(notes.strip()) < 5:
        raise Unprocessable("NOTES_REQUIRED", "Authorization notes are required.")
    route = session.get(PaymentRoute, bc.new_route_id) if bc.new_route_id else None
    if route is None:
        raise Unprocessable("ROUTE_MISSING", "The bank change has no route to authorize.")
    bc.authorized_by_id = actor.id
    bc.authorized_at = dt.datetime.now(dt.timezone.utc).isoformat()
    route.status = "VERIFIED"
    route.verified_at = bc.authorized_at
    route.provenance = (f"bank change {bc.id}: independent {bc.verification_method} to trusted contact "
                        f"{bc.trusted_contact_id} by {bc.verifier_id} at {bc.verification_occurred_at} "
                        f"(evidence {bc.verification_evidence_ref}); route authorized by {actor.id}")
    _set_state(session, bc, actor, "AUTHORIZED", notes=notes)
    _set_state(session, bc, actor, "REVALIDATION_REQUIRED")
    revalidated = _revalidate_vendor_invoices(session, bc.vendor_id, actor, f"bank change {bc.id} authorized")
    _set_state(session, bc, actor, "CLOSED", revalidated_invoices=revalidated)
    return bc


def onboard_vendor(session: Session, actor: User, *, legal_name: str, category: str | None, country: str,
                   province: str | None, gst_hst_number: str | None, contact_email: str | None) -> Vendor:
    require(actor, "vendor.onboard_request")
    n = (session.scalar(select(func.count()).select_from(Vendor).where(Vendor.source == "onboarding")) or 0) + 1
    v = Vendor(id=f"VN-{n:03d}", legal_name=legal_name, category=category, country=country,
               province_or_state=province, gst_hst_number=gst_hst_number, ap_contact_email=None,
               status="pending_review", source="onboarding", onboarded_at=None, requires_po=False,
               accepts_card_payment=False)
    session.add(v)
    if contact_email:
        # Contact supplied in the onboarding application is NOT a trusted callback channel.
        session.add(VendorContact(id=f"VC-{v.id}-APP", vendor_id=v.id, channel="email", value=contact_email,
                                  source="onboarding_application", established_at=dt.date.today().isoformat()))
    session.flush()
    audit.record(session, actor=actor, action="vendor.onboarding_requested", object_type="vendor", object_id=v.id,
                 after="pending_review", details={"legal_name": legal_name, "requested_by": actor.id})
    return v


def activate_vendor(session: Session, actor: User, vendor: Vendor, *, notes: str) -> Vendor:
    require(actor, "vendor.activate")
    if vendor.status not in {"pending_review", "new"}:
        raise Conflict("INVALID_TRANSITION", f"Vendor is {vendor.status}.")
    from app.db.models import AuditEvent
    requested_by = session.scalar(select(AuditEvent.actor_id).where(
        AuditEvent.object_type == "vendor", AuditEvent.object_id == vendor.id,
        AuditEvent.action == "vendor.onboarding_requested"))
    if requested_by == actor.id:
        raise Forbidden("TWO_PERSON_CONTROL", "The person who requested onboarding cannot activate the vendor.")
    if not notes or len(notes.strip()) < 10:
        raise Unprocessable("NOTES_REQUIRED", "Document the identity checks performed (≥ 10 characters).")
    old = vendor.status
    vendor.status = "active"
    vendor.onboarded_at = dt.date.today().isoformat()
    audit.record(session, actor=actor, action="vendor.activated", object_type="vendor", object_id=vendor.id,
                 before=old, after="active", details={"notes": notes,
                                                      "note": "Bank routes remain unverified until independently verified."})
    return vendor
