"""Read services (DashboardQueryService, invoice/case/vendor views, Flight Recorder).
`allowed_actions` and `blocked_reasons` are computed server-side for the acting user; the UI
renders them, and every mutation re-checks on submit."""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import can_view_invoice, has
from app.db.models import (
    AnomalyResult,
    AuditEvent,
    Contract,
    Document,
    DuplicateCandidate,
    EmailMessage,
    GLAccount,
    IntakeItem,
    Invoice,
    InvoiceVersion,
    Payment,
    PaymentMethodChange,
    PaymentRoute,
    ResolutionCase,
    User,
    Vendor,
    VendorBankChange,
    VendorContact,
    utcnow,
)
from app.schemas import dto
from app.services import approval_policy, bank, card_routes, catalog, lifecycle as lc, pipeline, resolution
from app.services.validation import OPEN_BANK_CHANGE_STATES
from app.services.vendors import mask, similar_identities
from app.services import policy_settings

STATE_LABEL = {
    "RECEIVED": "Received — processing", "DRAFT": "Processing", "EXTRACTED": "Processing", "CODED": "Processing",
    "VALIDATED": "Checks complete", "PENDING_APPROVAL": "Waiting for approval",
    "APPROVED": "Approved — ready to schedule a simulated payment",
    "SCHEDULED": "Simulated payment scheduled — awaiting independent release",
    "RELEASED": "Simulated payment released — awaiting simulated settlement",
    "SETTLED": "Paid (simulated settlement)", "REJECTED": "Rejected", "CANCELLED": "Cancelled",
    "FAILED": "Simulated payment failed", "CREDIT_RECORDED": "Credit recorded against supplier balance",
}


def user_out(u: User) -> dto.UserOut:
    return dto.UserOut(id=u.id, full_name=u.full_name, title=u.title, role=u.role, department_id=u.department_id,
                       manager_id=u.manager_id, status=u.status, status_since=u.status_since,
                       delegate_user_id=u.delegate_user_id, approval_limit_minor=u.approval_limit_minor, kind=u.kind)


def payment_out(p: Payment) -> dto.PaymentOut:
    return dto.PaymentOut(id=p.id, invoice_id=p.invoice_id, invoice_version=p.invoice_version, method=p.method,
                          route_id=p.route_id, currency=p.currency, amount_minor=p.amount_minor,
                          amount_cad_minor=p.amount_cad_minor, state=p.state, simulation=p.simulation,
                          label="SIMULATED — no real money moves" if p.simulation else "Historical ledger record",
                          source=p.source, prepared_by_id=p.prepared_by, released_by_id=p.released_by,
                          reference=p.reference, idempotency_key_hash=p.idempotency_key_hash,
                          scheduled_date=p.scheduled_date, created_at=p.created_at, released_at=p.released_at,
                          settled_at=p.settled_at)


def payment_json(p: Payment) -> dict[str, Any]:
    return payment_out(p).model_dump(mode="json")


class Ctx:
    """Per-request cache of master data used by view builders."""

    def __init__(self, session: Session, actor: User):
        self.s = session
        self.actor = actor
        self.users = pipeline.users_map(session)
        self.vendors = {v.id: v for v in session.scalars(select(Vendor))}

    def name(self, uid: str | None) -> str | None:
        u = self.users.get(uid or "")
        return u.full_name if u else uid


def _live_payment(s: Session, inv: Invoice) -> Payment | None:
    return s.scalar(select(Payment).where(Payment.invoice_id == inv.id, Payment.state.not_in(["CANCELLED"]))
                    .order_by(Payment.created_at.desc()))


def actions_for(ctx: Ctx, inv: Invoice, v: InvoiceVersion, blocking: list, steps: list) -> list[str]:
    a, s = ctx.actor, ctx.s
    if inv.source_kind == "historical_ledger" or a.kind != "human" or a.status != "active":
        return []
    out = []
    st = inv.lifecycle_state
    if has(a, "invoice.edit") and st in lc.PRE_PAYMENT_EDITABLE:
        out.append("edit_fields")
    if has(a, "invoice.coding_decision") and st in lc.PRE_PAYMENT_EDITABLE - {lc.REJECTED}:
        out.append("coding_decision")
    if has(a, "invoice.revalidate") and st in lc.REVALIDATABLE:
        out.append("revalidate")
    if has(a, "finding.dismiss") and any(catalog.info(f.code).dismissible for f in blocking):
        out.append("dismiss_finding")
    if has(a, "finding.dismiss") and st == lc.ON_HOLD:
        out.append("cancel")
    if st == lc.PENDING_APPROVAL and not blocking and a.id != v.requester_id:
        for step, status, _d in steps:
            if status == "PENDING" and step.assigned_actor_id == a.id:
                out += ["approve", "reject"]
    if st in {lc.APPROVED, lc.FAILED} and has(a, "payment.prepare"):
        out.append("prepare_payment")
    if st == lc.SCHEDULED and has(a, "payment.release"):
        p = _live_payment(s, inv)
        approvers = {d.actor_id for _s, _st, d in steps if d is not None}
        roles = approval_policy.release_authority_roles(p.amount_cad_minor, policy_settings.current(s)) if p else []
        if p and a.role in roles and a.id not in approvers \
                and a.id != p.prepared_by and a.id != v.requester_id:
            out.append("release_payment")
    if st == lc.RELEASED and has(a, "payment.settle_simulation"):
        out.append("simulate_settlement")
    return out


def _owner(ctx: Ctx, inv: Invoice, v: InvoiceVersion, steps: list, cases: list[ResolutionCase]) -> str | None:
    if inv.lifecycle_state == lc.PENDING_APPROVAL:
        for step, status, _ in steps:
            if status == "PENDING":
                return ctx.name(step.assigned_actor_id)
    if inv.lifecycle_state == lc.ON_HOLD and cases:
        c = cases[0]
        return ctx.name(c.owner_id) if c.owner_id else "AP team"
    if inv.lifecycle_state in {lc.APPROVED, lc.FAILED}:
        return "AP team"
    if inv.lifecycle_state == lc.SCHEDULED:
        return "Independent releaser (finance manager / controller)"
    if v.requester_id and ctx.users.get(v.requester_id) and ctx.users[v.requester_id].status == "terminated":
        dept = v.department_id
        mgr = next((u for u in ctx.users.values() if u.role == "approver" and u.department_id == dept), None)
        return ctx.name(mgr.id) if mgr else None
    return None


def _primary(ctx: Ctx, inv: Invoice, allowed: list[str], blocking: list, cases: list[ResolutionCase]) -> dto.PrimaryAction:
    st = inv.lifecycle_state
    if st == lc.ON_HOLD:
        codes = {f.code for f in blocking}
        if codes & {"BANK_CHANGE_UNVERIFIED", "BANK_DETAILS_MISMATCH"}:
            return dto.PrimaryAction(kind="review_bank_details", label="Review bank details")
        top = blocking[0] if blocking else None
        return dto.PrimaryAction(kind="resolve_issue", label=f"Resolve: {top.title}" if top else "Review hold")
    if "approve" in allowed:
        return dto.PrimaryAction(kind="approve", label="Review & approve")
    if "release_payment" in allowed:
        return dto.PrimaryAction(kind="release_payment", label="Release simulated payment")
    if "prepare_payment" in allowed:
        return dto.PrimaryAction(kind="prepare_payment", label="Schedule simulated payment")
    if "simulate_settlement" in allowed:
        return dto.PrimaryAction(kind="simulate_settlement", label="Record simulated settlement")
    if st == lc.PENDING_APPROVAL:
        return dto.PrimaryAction(kind="view_approval", label="View approval progress")
    if st in {lc.SCHEDULED, lc.RELEASED, lc.SETTLED}:
        return dto.PrimaryAction(kind="view_payment", label="View payment journey")
    return dto.PrimaryAction(kind="view_record", label="View invoice")


def summary(ctx: Ctx, inv: Invoice, v: InvoiceVersion | None = None) -> dto.InvoiceSummary:
    s = ctx.s
    v = v or pipeline.current_version(s, inv)
    findings = pipeline.latest_findings(s, inv.id, v.version) if inv.source_kind != "historical_ledger" else []
    blocking = sorted([f for f in findings if f.blocking],
                      key=lambda f: -resolution.SEVERITY_RANK.get(f.severity, 0))
    steps = pipeline.step_statuses(s, inv.id, v.version)
    cases = list(s.scalars(select(ResolutionCase).where(ResolutionCase.invoice_id == inv.id,
                                                        ResolutionCase.state.not_in(resolution.CLOSED_STATES))))
    allowed = actions_for(ctx, inv, v, blocking, steps)
    blocked = [f"{f.title}" for f in blocking]
    if inv.lifecycle_state == lc.PENDING_APPROVAL:
        pend = next((st for st in steps if st[1] == "PENDING"), None)
        if pend:
            blocked.append(f"Waiting for {ctx.name(pend[0].assigned_actor_id)} ({pend[0].step_key}) to approve")
    plain = STATE_LABEL.get(inv.lifecycle_state, inv.lifecycle_state)
    if inv.lifecycle_state == lc.ON_HOLD:
        plain = f"Payment paused — {blocking[0].title}" if blocking else "Payment paused"
    elif inv.lifecycle_state == lc.PENDING_APPROVAL and blocked:
        plain = blocked[-1]
    vendor = ctx.vendors.get(inv.vendor_id or "")
    return dto.InvoiceSummary(
        id=inv.id, invoice_number=v.invoice_number_raw, vendor_id=inv.vendor_id,
        vendor_name=vendor.legal_name if vendor else v.vendor_name_raw, version=v.version, row_version=inv.row_version,
        kind=inv.kind, currency=v.currency, amount_minor=v.total_minor, amount_cad_minor=v.amount_cad_minor,
        invoice_date=v.invoice_date, due_date=v.due_date, lifecycle_state=inv.lifecycle_state, plain_status=plain,
        risk_band=inv.risk_band, risk_score=inv.risk_score, blocking_findings_count=len(blocking),
        allowed_actions=allowed, blocked_reasons=blocked, source_kind=inv.source_kind, department_id=v.department_id,
        requester_id=v.requester_id, owner=_owner(ctx, inv, v, steps, cases),
        primary_action=_primary(ctx, inv, allowed, blocking, cases))


def finding_out(f) -> dto.FindingOut:  # noqa: ANN001
    return dto.FindingOut(id=f.id, invoice_id=f.invoice_id, version=f.version, check=f.check, code=f.code,
                          result=f.result, severity=f.severity, blocking=f.blocking,
                          dismissible=catalog.info(f.code).dismissible and f.result in {"FAIL", "UNKNOWN"},
                          title=f.title, rationale=f.rationale, why_it_matters=f.why_it_matters,
                          next_action=f.next_action, policy_ids=f.policy_ids, evidence_refs=f.evidence, data=f.data,
                          dismissed_by=f.dismissed_by, dismissal_reason=f.dismissal_reason)


def case_summary(ctx: Ctx, c: ResolutionCase) -> dto.CaseSummary:
    allowed = []
    a = ctx.actor
    if c.state not in resolution.CLOSED_STATES and a.kind == "human" and a.status == "active":
        if has(a, "case.update"):
            allowed += ["note", "request_information", "escalate"]
        if a.role == "controller_admin":
            allowed.append("document_decision")
        if c.bank_change_id and has(a, "case.authorization_request"):
            allowed.append("authorization_request")
    return dto.CaseSummary(id=c.id, invoice_id=c.invoice_id, invoice_version=c.invoice_version,
                           case_type=c.case_type, title=catalog.info(c.case_type).title, state=c.state,
                           severity=c.severity, owner_role=c.owner_role, owner_id=c.owner_id,
                           finding_ids=c.finding_ids, bank_change_id=c.bank_change_id,
                           closure_outcome=c.closure_outcome, row_version=c.row_version, allowed_actions=allowed,
                           created_at=c.created_at, updated_at=c.updated_at)


def detail(ctx: Ctx, inv: Invoice) -> dto.InvoiceDetail:
    s = ctx.s
    v = pipeline.current_version(s, inv)
    base = summary(ctx, inv, v)
    gl_names = {g.account_number: g.name for g in s.scalars(select(GLAccount))}
    lines = [dto.LineOut(line_no=ln.line_no, description=ln.description, quantity=ln.quantity,
                         unit_price_minor=ln.unit_price_minor, amount_minor=ln.amount_minor, line_type=ln.line_type,
                         gl_account=ln.gl_account, gl_name=gl_names.get(ln.gl_account or ""),
                         department_id=ln.department_id, coding_confidence=ln.coding_confidence,
                         coding_status=ln.coding_status, coding_method=ln.coding_method,
                         alternatives=(ln.coding_detail or {}).get("alternatives", []),
                         similar_lines=(ln.coding_detail or {}).get("similar_lines", []))
             for ln in pipeline.version_lines(s, inv.id, v.version)]
    findings = pipeline.latest_findings(s, inv.id, v.version)
    steps = pipeline.step_statuses(s, inv.id, v.version)
    chain = [dto.ApprovalStepOut(
        id=st.id, step_index=st.step_index, step_key=st.step_key, required_role=st.required_role,
        trigger_policy_ids=st.policy_ids, eligible_actor_ids=[st.assigned_actor_id] if st.assigned_actor_id else [],
        assigned_actor_id=st.assigned_actor_id, assigned_actor_name=ctx.name(st.assigned_actor_id),
        delegated_from_id=st.delegated_from_id, escalation_reason=st.escalation_reason, status=status,
        decided_by_id=d.actor_id if d else None, decided_at=d.decided_at if d else None,
        decision_reason=d.reason if d else None) for st, status, d in steps]
    excluded = pipeline.release_exclusions(s, inv, v)
    p = _live_payment(s, inv)
    if p and p.prepared_by:
        excluded.add(p.prepared_by)
    rel = approval_policy.eligible_releasers(v.amount_cad_minor, ctx.users, excluded, policy_settings.current(s)) \
        if v.amount_cad_minor is not None and inv.kind == "invoice" else []
    dups = [dto.DuplicateOut(id=d.id, match_type=d.match_type, confirmed=d.confirmed, score=d.score,
                             matched_invoice_id=d.matched_invoice_id, matched_card_txn_id=d.matched_card_txn_id,
                             reasons=d.reasons)
            for d in s.scalars(select(DuplicateCandidate).where(DuplicateCandidate.invoice_id == inv.id,
                                                                DuplicateCandidate.version == v.version))]
    cases = [case_summary(ctx, c) for c in s.scalars(select(ResolutionCase).where(ResolutionCase.invoice_id == inv.id)
                                                     .order_by(ResolutionCase.created_at))]
    ar = s.scalar(select(AnomalyResult).where(AnomalyResult.invoice_id == inv.id, AnomalyResult.version == v.version)
                  .order_by(AnomalyResult.id.desc()))
    doc = s.get(Document, inv.document_id) if inv.document_id else None
    versions = [dto.VersionOut(version=x.version, created_at=x.created_at, created_by=x.created_by, reason=x.reason,
                               provenance=x.provenance, total_minor=x.total_minor, currency=x.currency)
                for x in s.scalars(select(InvoiceVersion).where(InvoiceVersion.invoice_id == inv.id)
                                   .order_by(InvoiceVersion.version))]
    remit = dict(v.remit or {})
    remit.pop("account_fingerprint", None)
    if remit.get("account_last4"):
        remit["account_masked"] = mask(remit.pop("account_last4"))
    if remit.get("method") and inv.vendor_id:
        route = None
        if remit.get("method") == "EFT" and (v.remit or {}).get("account_fingerprint"):
            route = s.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == inv.vendor_id,
                                                        PaymentRoute.account_fingerprint == v.remit["account_fingerprint"]))
        elif remit.get("method") in {"CARD", "CHEQUE"}:
            route = s.scalar(select(PaymentRoute).where(PaymentRoute.vendor_id == inv.vendor_id,
                                                        PaymentRoute.method == remit["method"]))
        remit["route"] = {"id": route.id, "status": route.status, "provenance": route.provenance} if route else None
    ev_fields = (v.evidence or {}).get("fields", {})
    return dto.InvoiceDetail(
        **base.model_dump(), provenance=v.provenance, language=v.language,
        document_refs=[{"id": doc.id, "filename": doc.filename, "sha256": doc.sha256, "mime_type": doc.mime_type,
                        "size_bytes": doc.size_bytes, "url": f"/api/v1/invoices/{inv.id}/document",
                        "extraction_provenance": doc.extraction_provenance, "source_ref": doc.source_ref,
                        "ocr": (v.evidence or {}).get("ocr")}] if doc else [],
        extracted_fields={"vendor_name": v.vendor_name_raw, "vendor_tax_id": v.vendor_tax_id,
                          "vendor_match": v.vendor_match, "document_type": v.document_type,
                          "invoice_number": v.invoice_number_raw, "invoice_date": v.invoice_date,
                          "due_date": v.due_date, "received_date": v.received_date, "terms": v.terms_raw,
                          "po_number": v.po_number, "ship_to_province": v.ship_to_province,
                          "contract_id": v.contract_id, "department_source": v.department_source,
                          "requester_source": v.requester_source, "source_text": ev_fields},
        uncertain_fields=v.uncertain_fields or [], line_items=lines, taxes=v.taxes or [],
        subtotal_minor=v.subtotal_minor,
        fx={"rate": v.fx_rate, "date": v.fx_date, "source": "fx_rates.csv"} if v.currency == "USD" else None,
        remit=remit, validation_findings=[finding_out(f) for f in findings], duplicate_candidates=dups,
        approval_chain=chain, eligible_releasers=rel, resolution_cases=cases,
        payment_summary=payment_out(p) if p else None,
        anomaly=dto.AnomalyOut(method_version=ar.method_version, status=ar.status, band=ar.band, score=ar.score,
                               as_of=ar.as_of, signals=ar.signals, inputs=ar.inputs) if ar else None,
        versions=versions,
        evidence_refs=[e for f in findings for e in f.evidence])


def visible(ctx: Ctx, inv: Invoice, v: InvoiceVersion | None = None) -> bool:
    v = v or pipeline.current_version(ctx.s, inv)
    assigned = {st.assigned_actor_id for st in pipeline.approval_steps(ctx.s, inv.id, v.version)}
    return can_view_invoice(ctx.actor, inv, v, assigned)


# ------------------------------------------------------------------ card routes / method changes
def card_route_out(ctx: Ctx, r: PaymentRoute) -> dto.CardRouteOut:
    a = ctx.actor
    allowed = []
    if r.status == "UNVERIFIED" and r.registered_by and has(a, "card_route.verify") and a.id != r.registered_by:
        allowed.append("record_verification")
    return dto.CardRouteOut(
        id=r.id, vendor_id=r.vendor_id, method="CARD", status=r.status,
        merchant_reference_masked=mask(r.account_last4), provenance=r.provenance, registered_by=r.registered_by,
        registered_at=r.registered_at, verified_by=r.verified_by, verified_at=r.verified_at,
        verification={k: v for k, v in (r.verification or {}).items()}, row_version=r.row_version or 1,
        allowed_actions=allowed)


def method_change_out(ctx: Ctx, c: PaymentMethodChange) -> dto.MethodChangeOut:
    a = ctx.actor
    inv = ctx.s.get(Invoice, c.invoice_id)
    current = inv is not None and inv.current_version == c.invoice_version
    route = ctx.s.get(PaymentRoute, c.route_id)
    v = pipeline.current_version(ctx.s, inv) if inv is not None else None
    excluded = {c.requested_by, v.requester_id if v else None,
                route.registered_by if route else None, route.verified_by if route else None}
    allowed = []
    if c.state == "REQUESTED" and current and has(a, "payment_method.authorize") and a.id not in excluded:
        allowed += ["authorize", "decline"]
    return dto.MethodChangeOut(
        id=c.id, invoice_id=c.invoice_id, invoice_version=c.invoice_version, vendor_id=c.vendor_id,
        from_method=c.from_method, to_method=c.to_method, route_id=c.route_id, state=c.state,
        requested_by=c.requested_by, requested_at=c.requested_at.isoformat(), reason=c.reason,
        gate_snapshot=c.gate_snapshot or {}, supporting_card_history=c.supporting_card_history or {},
        decided_by=c.decided_by, decided_at=c.decided_at.isoformat() if c.decided_at else None,
        decision_notes=c.decision_notes, row_version=c.row_version, applies_to_current_version=current,
        allowed_actions=allowed)


# ------------------------------------------------------------------ bank / cases
def bank_change_out(ctx: Ctx, bc: VendorBankChange) -> dto.BankChangeOut:
    a = ctx.actor
    allowed = []
    if bc.state == "PENDING_INDEPENDENT_VERIFICATION" and has(a, "bank_change.verify") and a.id != bc.requested_by_user_id:
        allowed.append("record_verification")
    if bc.state == "PENDING_ROUTE_AUTHORIZATION" and has(a, "bank_change.authorize") and \
            a.id not in {bc.verifier_id, bc.requested_by_user_id}:
        allowed.append("authorize_route")
    contacts = [dto.ContactOut(id=c.id, channel=c.channel, value=c.value, source=c.source,
                               established_at=c.established_at) for c in bank.trusted_contacts(ctx.s, bc)]
    return dto.BankChangeOut(
        id=bc.id, vendor_id=bc.vendor_id, requested_at=bc.requested_at, requested_by_user_id=bc.requested_by_user_id,
        request_channel=bc.request_channel, old_account_masked=mask(bc.old_account_last4),
        new_account_masked=mask(bc.new_account_last4), state=bc.state, source=bc.source, verifier_id=bc.verifier_id,
        trusted_contact_id=bc.trusted_contact_id, verification_method=bc.verification_method,
        verification_occurred_at=bc.verification_occurred_at, verification_outcome=bc.verification_outcome,
        verification_evidence_ref=bc.verification_evidence_ref, authorized_by_id=bc.authorized_by_id,
        authorized_at=bc.authorized_at, row_version=bc.row_version, trusted_contacts=contacts,
        allowed_actions=allowed)


def wizard(ctx: Ctx, case: ResolutionCase, bc: VendorBankChange | None, inv: Invoice) -> dto.WizardOut:
    s = ctx.s
    verified = bc is not None and bc.state in {"VERIFICATION_RECORDED", "PENDING_ROUTE_AUTHORIZATION", "AUTHORIZED",
                                               "REVALIDATION_REQUIRED", "CLOSED"}
    authorized = bc is not None and bc.state in {"AUTHORIZED", "REVALIDATION_REQUIRED", "CLOSED"}
    requested = any(a.action_type == "authorization_request" for a in resolution.case_actions(s, case.id))
    failures = []
    if bc is not None and not bank.trusted_contacts(s, bc):
        failures.append("TRUSTED_CONTACT_MISSING")
    if bc is not None and bc.state == "REJECTED":
        failures.append("CALLBACK_DENIED_CHANGE")
    vendor = ctx.vendors.get(inv.vendor_id or "")
    card_route = card_routes.verified_card_route(s, inv.vendor_id)
    pmc = card_routes.active_change(s, inv.id, inv.current_version)
    pending_pmc = next((c for c in card_routes.changes_for(s, inv.id)
                        if c.state == "REQUESTED" and c.invoice_version == inv.current_version), None)
    eft_route = s.get(PaymentRoute, bc.new_route_id) if bc and bc.new_route_id else None
    options = [{"method": "EFT", "available": bool(eft_route and eft_route.status == "VERIFIED"),
                "account_masked": mask(eft_route.account_last4) if eft_route else None,
                "reason": None if eft_route and eft_route.status == "VERIFIED" else
                "EFT is offered only after independent verification and finance authorization of the new account."},
               {"method": "CARD", "label": "Brim virtual card (simulated)", "available": card_route is not None,
                "reason": None if card_route else
                ("No separately verified merchant route on file"
                 + ("; vendor does not accept card" if vendor and not vendor.accepts_card_payment else "")
                 + ". Card transaction history alone never proves merchant ownership."),
                "method_change": {"id": (pmc or pending_pmc).id, "state": (pmc or pending_pmc).state}
                if (pmc or pending_pmc) else None,
                "requires": "finance-manager authorization of the method change (two-person control)"}]
    if card_route is None:
        failures.append("VERIFIED_CARD_ROUTE_UNAVAILABLE")
    if any(f.code == "NO_ELIGIBLE_RELEASER" for f in pipeline.blocking_findings(s, inv.id, inv.current_version)):
        failures.append("NO_ELIGIBLE_RELEASER")
    hold = inv.lifecycle_state == lc.ON_HOLD or (not authorized and pmc is None)
    steps = [
        {"key": "review", "label": "Review", "done": True},
        {"key": "verify_supplier", "label": "Verify supplier", "done": verified},
        {"key": "choose_route", "label": "Choose payment route", "done": authorized or pmc is not None},
        {"key": "request_authorization", "label": "Request authorization", "done": requested},
    ]
    current = next((st["key"] for st in steps if not st["done"]), "done")
    return dto.WizardOut(current_step=current, steps=steps, route_options=options, failure_states=failures,
                         hold_active=hold)


def case_detail(ctx: Ctx, case: ResolutionCase) -> dto.CaseDetail:
    s = ctx.s
    inv = s.get(Invoice, case.invoice_id)
    assert inv is not None
    bc = s.get(VendorBankChange, case.bank_change_id) if case.bank_change_id else None
    findings = resolution.case_findings(s, case)
    return dto.CaseDetail(
        **case_summary(ctx, case).model_dump(), path_to_pay_steps=resolution.path_to_pay(s, case),
        findings=[finding_out(f) for f in findings],
        actions=[dto.CaseActionOut(id=a.id, action_type=a.action_type, status=a.status, actor_id=a.actor_id,
                                   notes=a.notes, data=a.data, created_at=a.created_at)
                 for a in resolution.case_actions(s, case.id)],
        evidence_refs=[e for f in findings for e in f.evidence],
        bank_change=bank_change_out(ctx, bc) if bc else None,
        wizard=wizard(ctx, case, bc, inv) if case.case_type in {"BANK_CHANGE_UNVERIFIED", "BANK_DETAILS_MISMATCH"} else None,
        invoice=summary(ctx, inv))


# ------------------------------------------------------------------ vendors
def vendor_out(ctx: Ctx, v: Vendor) -> dto.VendorOut:
    open_bc = ctx.s.scalar(select(VendorBankChange.id).where(VendorBankChange.vendor_id == v.id,
                                                             VendorBankChange.state.in_(OPEN_BANK_CHANGE_STATES)))
    return dto.VendorOut(id=v.id, legal_name=v.legal_name, category=v.category, status=v.status, country=v.country,
                         province_or_state=v.province_or_state, requires_po=v.requires_po,
                         preferred_payment_method=v.preferred_payment_method,
                         accepts_card_payment=v.accepts_card_payment,
                         bank_account_masked=mask(v.bank_account[-4:]) if v.bank_account else None,
                         has_open_bank_change=open_bc is not None, source=v.source)


def vendor_detail(ctx: Ctx, v: Vendor) -> dto.VendorDetail:
    s = ctx.s
    payable = credit = 0
    for inv in s.scalars(select(Invoice).where(Invoice.vendor_id == v.id, Invoice.source_kind != "historical_ledger")):
        cv = pipeline.current_version(s, inv)
        if inv.kind == "credit_note" and inv.lifecycle_state == lc.CREDIT_RECORDED:
            credit += cv.total_minor or 0
        elif inv.kind == "invoice" and inv.lifecycle_state not in {lc.SETTLED, lc.CANCELLED, lc.REJECTED, lc.RELEASED}:
            payable += cv.amount_cad_minor or 0
    return dto.VendorDetail(
        **vendor_out(ctx, v).model_dump(), gst_hst_number=v.gst_hst_number, payment_terms_days=v.payment_terms_days,
        contacts=[dto.ContactOut(id=c.id, channel=c.channel, value=c.value, source=c.source,
                                 established_at=c.established_at)
                  for c in s.scalars(select(VendorContact).where(VendorContact.vendor_id == v.id))],
        bank_changes=[bank_change_out(ctx, bc) for bc in s.scalars(
            select(VendorBankChange).where(VendorBankChange.vendor_id == v.id).order_by(VendorBankChange.requested_at))],
        routes=[dto.RouteOut(id=r.id, method=r.method, account_masked=mask(r.account_last4), status=r.status,
                             provenance=r.provenance, verified_at=r.verified_at, bank_change_id=r.bank_change_id)
                for r in s.scalars(select(PaymentRoute).where(PaymentRoute.vendor_id == v.id))],
        similar_identities=similar_identities(s, v), open_payable_minor=payable, credit_balance_minor=credit,
        contracts=[{"id": c.id, "description": c.description, "billing_type": c.billing_type, "status": c.status,
                    "start_date": c.start_date, "end_date": c.end_date, "currency": c.currency,
                    "monthly_fee_minor": c.monthly_fee_minor, "hourly_rate_cap_minor": c.hourly_rate_cap_minor,
                    "fuel_surcharge_cap_pct": c.fuel_surcharge_cap_pct,
                    "not_to_exceed_monthly_minor": c.not_to_exceed_monthly_minor}
                   for c in s.scalars(select(Contract).where(Contract.vendor_id == v.id))])


# ------------------------------------------------------------------ dashboard
SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def dashboard(ctx: Ctx) -> dto.DashboardOut:
    s, a = ctx.s, ctx.actor
    need, appr, pay = [], [], []
    invs = list(s.scalars(select(Invoice).where(Invoice.source_kind != "historical_ledger")))
    for inv in invs:
        v = pipeline.current_version(s, inv)
        if not visible(ctx, inv, v):
            continue
        st = inv.lifecycle_state
        if a.role == "auditor":
            continue  # auditors get read-only audit views, not tasks
        sm = summary(ctx, inv, v)
        task = dto.TaskOut(invoice=sm, plain_status=sm.plain_status, owner=sm.owner, primary_action=sm.primary_action)
        if st == lc.ON_HOLD:
            if a.role == "approver":
                continue  # approvers see approval tasks; holds are AP investigation work
            need.append(task)
        elif st == lc.PENDING_APPROVAL:
            if a.role in {"ap_clerk", "employee"} or "approve" in sm.allowed_actions:
                appr.append(task)
        elif st in {lc.APPROVED, lc.SCHEDULED, lc.RELEASED, lc.FAILED}:
            if a.role == "approver":
                continue
            pay.append(task)
    risk_rank = {"high": 0, "medium": 1, "low": 2, "insufficient_history": 3}
    need.sort(key=lambda t: (risk_rank.get(t.invoice.risk_band or "", 4), -t.invoice.blocking_findings_count,
                             t.invoice.id))
    pay.sort(key=lambda t: (t.invoice.due_date or "9999", t.invoice.id))
    items = []
    if has(a, "intake.import") or a.role in {"finance_manager", "auditor"}:
        for it in s.scalars(select(IntakeItem).where(IntakeItem.payable.is_(False), IntakeItem.invoice_id.is_(None))):
            em = s.get(EmailMessage, it.email_id) if it.email_id else None
            items.append(dto.WorkItemOut(id=it.id, email_id=it.email_id, item_type=it.item_type, status=it.status,
                                         note=it.note, subject=em.subject if em else None,
                                         from_name=em.from_name if em else None, payable=False))
    return dto.DashboardOut(
        actor_id=a.id, role=a.role,
        counts={"needs_attention": len(need), "ready_for_approval": len(appr), "upcoming_payments": len(pay),
                "open_work_items": sum(1 for i in items if i.status == "OPEN")},
        needs_attention=need, ready_for_approval=appr, upcoming_payments=pay, work_items=items)


# ------------------------------------------------------------------ flight recorder
ACTION_LABEL = {
    "invoice.received": "Invoice received and stored with its SHA-256 hash",
    "invoice.extracted": "Fields extracted from the document",
    "invoice.transition": "Status changed",
    "invoice.validated": "All checks ran",
    "invoice.version_created": "New invoice version created (prior approvals no longer apply)",
    "approvals.invalidated": "Approvals invalidated by a material change",
    "case.opened": "Resolution case opened",
    "case.resolved": "Resolution case resolved by deterministic revalidation",
    "approval.approved": "Approved",
    "approval.rejected": "Rejected",
    "payment.scheduled": "Simulated payment scheduled",
    "payment.released": "Simulated payment released",
    "payment.simulated_settled": "Simulated settlement recorded",
    "payment.release_replayed": "Duplicate release request answered idempotently (no second payment)",
    "bank_change.verification_recorded": "Independent supplier verification recorded",
    "bank_change.transition": "Bank change status changed",
    "finding.dismissed": "Finding dismissed with documented reason",
    "coding.decision": "Coding confirmed or corrected",
    "case.authorization_requested": "Authorization requested (not an approval)",
    "investigation.model_call": "Sentinel AI read the evidence (model call)",
    "investigation.completed": "Investigation summary produced (proposals only; nothing executed)",
}


def flight_recorder(ctx: Ctx, inv: Invoice) -> dto.FlightRecorderOut:
    s = ctx.s
    bc_ids = {c.bank_change_id for c in s.scalars(select(ResolutionCase).where(ResolutionCase.invoice_id == inv.id))
              if c.bank_change_id}
    pay_ids = {p.id for p in s.scalars(select(Payment).where(Payment.invoice_id == inv.id))}
    q = select(AuditEvent).where(
        (AuditEvent.invoice_id == inv.id) | (AuditEvent.object_id.in_(bc_ids | pay_ids))).order_by(AuditEvent.id)
    events = []
    for e in s.scalars(q):
        label = ACTION_LABEL.get(e.action, e.action)
        if e.action == "investigation.lookup":
            who = "Sentinel AI" if (e.details or {}).get("chosen_by") == "model" else "Sentinel"
            label = f"{who} looked up {(e.details or {}).get('tool', 'evidence')} (read-only)"
        # Before/after states are sent separately and shown in plain words by the UI.
        if e.result == "DENIED":
            msg = (e.details or {}).get("message") or "the action was not permitted"
            label = f"Blocked attempt — {msg}"
        events.append(dto.FlightEvent(kind="persisted", id=str(e.id), occurred_at=e.occurred_at, actor_id=e.actor_id,
                                      actor_name=ctx.name(e.actor_id) if e.actor_id else "Sentinel (system)",
                                      action=e.action, label=label, before_state=e.before_state,
                                      after_state=e.after_state, result=e.result, policy_ids=e.policy_ids,
                                      evidence_refs=e.evidence))
    proposed = []
    for c in s.scalars(select(ResolutionCase).where(ResolutionCase.invoice_id == inv.id,
                                                    ResolutionCase.state.not_in(resolution.CLOSED_STATES))):
        for step in resolution.path_to_pay(s, c):
            if step["status"] != "DONE":
                proposed.append(dto.FlightEvent(kind="proposed", id=f"{c.id}:{step['key']}", occurred_at=None,
                                                actor_id=None, actor_name=step["actor_role"], action=step["key"],
                                                label=f"Not yet happened — {step['label']}", before_state=None,
                                                after_state=None, result=None, policy_ids=[], evidence_refs=[]))
    return dto.FlightRecorderOut(invoice_id=inv.id, as_of=utcnow(), events=events, proposed_next=proposed)
