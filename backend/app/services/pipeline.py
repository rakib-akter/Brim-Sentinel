"""Invoice processing pipeline (explicit command handler composing the services):

  Document → extraction → InvoiceVersion → coding → validation + duplicates + anomaly →
  approval routing (+ predictive releaser check) → ON_HOLD + ResolutionCase | PENDING_APPROVAL

Re-run on every revalidation and material edit. Findings are persisted per (version, run);
the latest run of the current version is authoritative."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.db.models import (
    ApprovalDecision,
    ApprovalStep,
    Department,
    Document,
    DuplicateCandidate,
    FindingDismissal,
    IntakeItem,
    Invoice,
    InvoiceLine,
    InvoiceVersion,
    Payment,
    User,
    ValidationFinding,
)
from app.db.seed import account_fingerprint
from app.services import anomaly, approval_policy, audit, catalog, coding, duplicates, extraction, lifecycle as lc
from app.services import resolution, validation
from app.services import vendors as vendor_svc
from app.services.validation import Result


def users_map(session: Session) -> dict[str, User]:
    return {u.id: u for u in session.scalars(select(User))}


def current_version(session: Session, invoice: Invoice) -> InvoiceVersion:
    v = session.scalar(select(InvoiceVersion).where(InvoiceVersion.invoice_id == invoice.id,
                                                    InvoiceVersion.version == invoice.current_version))
    if v is None:
        raise NotFound("VERSION_NOT_FOUND", f"Invoice {invoice.id} has no version {invoice.current_version}.")
    return v


def version_lines(session: Session, invoice_id: str, version: int) -> list[InvoiceLine]:
    return list(session.scalars(select(InvoiceLine).where(InvoiceLine.invoice_id == invoice_id,
                                                          InvoiceLine.version == version)
                                .order_by(InvoiceLine.line_no)))


def latest_findings(session: Session, invoice_id: str, version: int) -> list[ValidationFinding]:
    run = session.scalar(select(func.max(ValidationFinding.run_no)).where(
        ValidationFinding.invoice_id == invoice_id, ValidationFinding.version == version))
    if run is None:
        return []
    return list(session.scalars(select(ValidationFinding).where(
        ValidationFinding.invoice_id == invoice_id, ValidationFinding.version == version,
        ValidationFinding.run_no == run).order_by(ValidationFinding.id)))


def blocking_findings(session: Session, invoice_id: str, version: int) -> list[ValidationFinding]:
    return [f for f in latest_findings(session, invoice_id, version) if f.blocking]


def approval_steps(session: Session, invoice_id: str, version: int) -> list[ApprovalStep]:
    return list(session.scalars(select(ApprovalStep).where(ApprovalStep.invoice_id == invoice_id,
                                                           ApprovalStep.version == version)
                                .order_by(ApprovalStep.step_index)))


def decisions(session: Session, invoice_id: str, version: int) -> dict[str, ApprovalDecision]:
    return {d.step_key: d for d in session.scalars(select(ApprovalDecision).where(
        ApprovalDecision.invoice_id == invoice_id, ApprovalDecision.version == version))}


def step_statuses(session: Session, invoice_id: str, version: int) -> list[tuple[ApprovalStep, str, ApprovalDecision | None]]:
    steps = approval_steps(session, invoice_id, version)
    decs = decisions(session, invoice_id, version)
    out = []
    pending_seen = False
    for s in steps:
        d = decs.get(s.step_key)
        if d is not None and d.actor_id == s.assigned_actor_id:
            out.append((s, d.decision, d))
        elif not pending_seen:
            out.append((s, "PENDING", None))
            pending_seen = True
        else:
            out.append((s, "WAITING", None))
    return out


def release_exclusions(session: Session, inv: Invoice, v: InvoiceVersion) -> set[str]:
    """People who may not release this invoice version (segregation of duties): assigned and
    actual approvers (P11), the requester, the author of a manual version (maker-checker), the
    requester/authorizer of a payment-method change for this version, and whoever scheduled a
    live payment."""
    from app.db.models import PaymentMethodChange

    out = {s.assigned_actor_id for s in approval_steps(session, inv.id, v.version) if s.assigned_actor_id}
    out |= {d.actor_id for d in decisions(session, inv.id, v.version).values()}
    if v.requester_id:
        out.add(v.requester_id)
    if v.provenance == "manual" and v.created_by:
        out.add(v.created_by)
    for c in session.scalars(select(PaymentMethodChange).where(
            PaymentMethodChange.invoice_id == inv.id, PaymentMethodChange.invoice_version == v.version,
            PaymentMethodChange.state == "AUTHORIZED")):
        out |= {c.requested_by, c.decided_by} - {None}
    for p in session.scalars(select(Payment).where(Payment.invoice_id == inv.id, Payment.invoice_version == v.version,
                                                   Payment.source == "simulation",
                                                   Payment.state.not_in({"CANCELLED", "FAILED"}))):
        if p.prepared_by:
            out.add(p.prepared_by)
    return out


def all_approved(session: Session, invoice_id: str, version: int) -> bool:
    st = step_statuses(session, invoice_id, version)
    return bool(st) and all(s == "APPROVED" for _, s, _ in st)


# --------------------------------------------------------------------------- creation
def create_from_document(session: Session, *, invoice_id: str, document_id: str, email_id: str | None,
                         source_kind: str, actor: User | None, received_date: str | None,
                         uploader: User | None = None) -> Invoice:
    doc = session.get(Document, document_id)
    assert doc is not None
    ex = extraction.extract_document(Path(doc.storage_path), doc.filename)
    doc.text_layer = ex.raw_text[:50000] or None
    doc.extraction_provenance = ex.provenance
    inv = Invoice(id=invoice_id, source_kind=source_kind,
                  kind="credit_note" if ex.document_type == "credit_note" else "invoice",
                  email_id=email_id, document_id=document_id, lifecycle_state=lc.RECEIVED, current_version=1)
    session.add(inv)
    session.flush()
    audit.record(session, actor=actor, action="invoice.received", object_type="invoice", object_id=inv.id,
                 object_version=1, after=lc.RECEIVED,
                 evidence=[{"type": "document", "ref": doc.id, "sha256": doc.sha256, "filename": doc.filename}],
                 details={"source_kind": source_kind, "email_id": email_id})
    lc.transition(session, inv, lc.DRAFT, actor=actor, reason="draft created from attachment")

    match = vendor_svc.match_vendor(session, ex.vendor_name, ex.vendor_tax_id)
    inv.vendor_id = match.get("vendor_id")
    dept = coding.infer_department(session, inv.vendor_id, ex.po_number)
    dept_id, req_id, dept_src, req_src = dept["department_id"], dept["requester_id"], dept["source"], dept["source"]
    if uploader is not None and uploader.role in {"employee", "approver"}:
        dept_id, req_id, dept_src, req_src = uploader.department_id, uploader.id, "uploader", "uploader"
    remit = {k: v for k, v in ex.remit.items() if k != "account_full"}
    if ex.remit.get("account_full"):
        remit["account_fingerprint"] = account_fingerprint(ex.remit.get("institution"), ex.remit.get("transit"),
                                                           ex.remit["account_full"])
    v = InvoiceVersion(
        invoice_id=inv.id, version=1, created_by=actor.id if actor else "system", reason="initial extraction",
        provenance=ex.provenance, vendor_id=inv.vendor_id, vendor_name_raw=ex.vendor_name,
        vendor_tax_id=ex.vendor_tax_id, vendor_match=match, invoice_number_raw=ex.invoice_number,
        invoice_number_norm=extraction.normalize_invoice_number(ex.invoice_number), document_type=ex.document_type,
        invoice_date=ex.invoice_date, due_date=ex.due_date, received_date=received_date, terms_raw=ex.terms,
        currency=ex.currency, subtotal_minor=ex.subtotal_minor, taxes=ex.taxes, total_minor=ex.total_minor,
        remit=remit, ship_to_province=ex.ship_to_province, po_number=ex.po_number, department_id=dept_id,
        department_source=dept_src, requester_id=req_id, requester_source=req_src, language=ex.language,
        uncertain_fields=sorted(set(ex.uncertain_fields)),
        evidence={"fields": ex.evidence, "injection_phrases": ex.injection_phrases, "credit_ref": ex.credit_ref,
                  "document_id": doc.id, "extraction_status": ex.status, "ocr": ex.ocr or None})
    session.add(v)
    for ln in ex.lines:
        session.add(InvoiceLine(invoice_id=inv.id, version=1, line_no=ln.line_no, description=ln.description,
                                quantity=ln.quantity, unit_price_minor=ln.unit_price_minor,
                                amount_minor=ln.amount_minor))
    item_type = "unreadable" if ex.status != "EXTRACTED" else inv.kind
    session.add(IntakeItem(id=f"II-{inv.id}", email_id=email_id, document_id=doc.id, item_type=item_type,
                           payable=inv.kind == "invoice", invoice_id=inv.id, status="DRAFT_CREATED",
                           note=f"Extraction {ex.status} ({ex.provenance})"))
    session.flush()
    audit.record(session, actor=actor, action="invoice.extracted", object_type="invoice", object_id=inv.id,
                 object_version=1, details={"provenance": ex.provenance, "status": ex.status,
                                            "uncertain_fields": v.uncertain_fields, "vendor_match": match,
                                            "ocr": {k: ex.ocr.get(k) for k in ("status", "engine", "engine_version",
                                                                                "mean_confidence", "message")
                                                    if ex.ocr.get(k) is not None} or None},
                 evidence=[{"type": "document", "ref": doc.id}])
    process(session, inv, actor=actor, reason="initial intake")
    return inv


# --------------------------------------------------------------------------- processing
def _reenter(session: Session, inv: Invoice, actor: User | None, reason: str) -> None:
    if inv.lifecycle_state in {lc.DRAFT, lc.ON_HOLD, lc.PENDING_APPROVAL, lc.APPROVED, lc.REJECTED}:
        lc.transition(session, inv, lc.EXTRACTED, actor=actor, reason=reason)


def _persist(session: Session, inv: Invoice, v: InvoiceVersion, results: list[Result],
             dups: list[dict[str, Any]]) -> list[ValidationFinding]:
    run = (session.scalar(select(func.max(ValidationFinding.run_no)).where(
        ValidationFinding.invoice_id == inv.id, ValidationFinding.version == v.version)) or 0) + 1
    dismissals = {(d.code, d.subject): d for d in session.scalars(select(FindingDismissal).where(
        FindingDismissal.invoice_id == inv.id, FindingDismissal.version == v.version))}
    out = []
    for n, r in enumerate(results, start=1):
        meta = catalog.info(r.code)
        dis = dismissals.get((r.code, r.subject))
        blocking = r.blocking and not (dis is not None and meta.dismissible)
        f = ValidationFinding(
            id=f"F-{inv.id}-v{v.version}-r{run}-{n:02d}", invoice_id=inv.id, version=v.version, run_no=run,
            check=r.check, code=r.code, result=r.result, severity=r.severity, blocking=blocking,
            title=meta.title if r.result != "PASS" else r.rationale.split(".")[0],
            rationale=r.rationale, why_it_matters=meta.why if r.result != "PASS" else None,
            next_action=meta.next_action if r.result not in {"PASS", "NOT_APPLICABLE"} else None,
            policy_ids=r.policy_ids, evidence=r.evidence, data={**r.data, "subject": r.subject},
            dismissed_by=dis.actor_id if dis is not None and meta.dismissible else None,
            dismissal_reason=dis.reason if dis is not None and meta.dismissible else None)
        session.add(f)
        out.append(f)
    session.execute(delete(DuplicateCandidate).where(DuplicateCandidate.invoice_id == inv.id,
                                                     DuplicateCandidate.version == v.version))
    for n, c in enumerate(dups, start=1):
        session.add(DuplicateCandidate(id=f"DC-{inv.id}-v{v.version}-{n:02d}", invoice_id=inv.id, version=v.version,
                                       run_no=run, **c))
    session.flush()
    return out


def _route(session: Session, inv: Invoice, v: InvoiceVersion, vendor, po_over: bool) -> list[Result]:  # noqa: ANN001
    results: list[Result] = []
    session.execute(delete(ApprovalStep).where(ApprovalStep.invoice_id == inv.id, ApprovalStep.version == v.version))
    if inv.kind != "invoice" or v.amount_cad_minor is None or v.department_id is None:
        return results
    users = users_map(session)
    dept = session.get(Department, v.department_id)
    chain = approval_policy.build_chain(
        v.amount_cad_minor, dept_manager_id=dept.manager_user_id if dept else None, requester_id=v.requester_id,
        vendor_status=vendor.status if vendor else None, vendor_category=vendor.category if vendor else None,
        po_over_balance=po_over, users=users, maker_id=v.created_by if v.provenance == "manual" else None)
    for i, s in enumerate(chain.steps):
        session.add(ApprovalStep(id=f"AS-{inv.id}-v{v.version}-{s.step_key}", invoice_id=inv.id, version=v.version,
                                 step_index=i, step_key=s.step_key, required_role=s.required_role,
                                 policy_ids=s.policy_ids, authority_ceiling_minor=s.authority_ceiling_minor,
                                 assigned_actor_id=s.assigned_actor_id, delegated_from_id=s.delegated_from_id,
                                 escalation_reason=s.escalation_reason))
    session.flush()
    for b in chain.blocking_codes:
        results.append(Result("approval_routing", b["code"], "FAIL", True, b["reason"], "high",
                              policy_ids=["P01", "P02", "P03", "P04", "P07", "P08"]))
    if not chain.blocking_codes:
        excluded = {s.assigned_actor_id for s in chain.steps if s.assigned_actor_id}
        if v.requester_id:
            excluded.add(v.requester_id)
        if v.provenance == "manual" and v.created_by:
            excluded.add(v.created_by)  # maker-checker: the version author cannot release it either
        rel = approval_policy.eligible_releasers(v.amount_cad_minor, users, excluded)
        pol = ["P09", "P11"] if v.amount_cad_minor <= 100_000_00 else ["P10", "P11"]
        if not rel:
            results.append(Result(
                "release_routing", "NO_ELIGIBLE_RELEASER", "FAIL", True,
                f"Approval chain {[s.assigned_actor_id for s in chain.steps]} includes every user with release "
                f"authority for this amount ({approval_policy.release_authority_roles(v.amount_cad_minor)}); "
                f"P11 forbids an approver from releasing. Escalated for a documented decision — no override exists.",
                "critical", policy_ids=pol))
        else:
            results.append(Result("release_routing", "RELEASER_AVAILABLE", "PASS", False,
                                  f"Eligible independent releaser(s): {', '.join(rel)}.", policy_ids=pol,
                                  data={"eligible_releasers": rel}))
    return results


def process(session: Session, inv: Invoice, *, actor: User | None, reason: str,
            cascade: bool = True) -> list[ValidationFinding]:
    v = current_version(session, inv)
    lines = version_lines(session, inv.id, v.version)
    scheduled = inv.lifecycle_state == lc.SCHEDULED
    if not scheduled:
        _reenter(session, inv, actor, reason)

    if "document" in (v.uncertain_fields or []):
        results = [Result("extraction", "EXTRACTION_INCOMPLETE", "UNKNOWN", True,
                          "No readable text layer and OCR produced no usable text (or is unavailable) and no "
                          "labelled fixture exists. Manual entry required; nothing was guessed.", "high")]
        findings = _persist(session, inv, v, results, [])
        if inv.lifecycle_state != lc.ON_HOLD:
            lc.transition(session, inv, lc.ON_HOLD, actor=actor, reason="extraction failed")
        resolution.sync_cases(session, inv, v, findings, actor)
        return findings

    if not scheduled:
        lc.transition(session, inv, lc.EXTRACTED, actor=actor, reason=reason)
    coding.code_version(session, v)
    if not scheduled:
        lc.transition(session, inv, lc.CODED, actor=actor, reason="coding suggestions computed")
    results, ctx = validation.run_checks(session, v, lines)
    dups, dup_results = duplicates.find(session, inv, v)
    results.extend(dup_results)
    ar = anomaly.evaluate(session, inv, v)
    amount_part = (ar.inputs or {}).get("amount_component") or {}
    amount_sig = anomaly.amount_signal(ar)
    if ar.status == "SCORED" and amount_part.get("band") in {"high", "medium"} and amount_sig:
        results.append(Result("anomaly", "AMOUNT_UNUSUAL", "FAIL", False, amount_sig["explanation"] +
                              " Review priority only; not a fraud probability.", amount_part["band"],
                              data={"score": amount_part.get("score"), "band": amount_part.get("band"),
                                    "priority_score": ar.score, "priority_band": ar.band,
                                    "method": ar.method_version,
                                    **{k: ar.inputs.get(k) for k in ("history_count",)}}))
    elif ar.status == "INSUFFICIENT_HISTORY":
        results.append(Result("anomaly", "AMOUNT_HISTORY", "NOT_APPLICABLE", False,
                              f"Limited supplier history ({ar.inputs.get('history_count')} prior invoices): "
                              f"no amount score is given."))
    if inv.kind == "credit_note":
        ref = (v.evidence or {}).get("credit_ref")
        results.append(Result("credit_note", "CREDIT_NOTE", "PASS", False,
                              f"Credit note for {v.total_minor and abs(v.total_minor) / 100:,.2f} {v.currency}"
                              f"{' referencing ' + ref if ref else ''}; reduces the vendor balance and is never "
                              f"scheduled for payment."))
    results.extend(_route(session, inv, v, ctx["vendor"], ctx["po_over_balance"]))
    findings = _persist(session, inv, v, results, dups)
    has_block = any(f.blocking for f in findings)

    if scheduled:
        if has_block:
            _cancel_scheduled(session, inv, actor, "revalidation found a blocking issue")
            lc.transition(session, inv, lc.ON_HOLD, actor=actor, reason="hold found during revalidation")
    else:
        lc.transition(session, inv, lc.VALIDATED, actor=actor, reason="validation complete")
        if has_block:
            target = lc.ON_HOLD
        elif inv.kind == "credit_note":
            target = lc.CREDIT_RECORDED
        elif all_approved(session, inv.id, v.version):
            target = lc.APPROVED
        else:
            target = lc.PENDING_APPROVAL
        lc.transition(session, inv, target, actor=actor, reason=reason,
                      policy_ids=sorted({p for f in findings if f.blocking for p in f.policy_ids}))
    audit.record(session, actor=actor, action="invoice.validated", object_type="invoice", object_id=inv.id,
                 object_version=v.version, result="BLOCKED" if has_block else "SUCCESS",
                 details={"reason": reason, "blocking_codes": sorted({f.code for f in findings if f.blocking}),
                          "risk_band": inv.risk_band, "amount_cad_minor": v.amount_cad_minor,
                          "fx_rate": v.fx_rate, "fx_date": v.fx_date},
                 evidence=[{"type": "finding", "ref": f.id} for f in findings if f.result in {"FAIL", "UNKNOWN"}])
    resolution.sync_cases(session, inv, v, findings, actor)
    if cascade:
        _cascade_split_billing(session, inv, findings, actor)
    return findings


def _cascade_split_billing(session: Session, inv: Invoice, findings: list[ValidationFinding],
                           actor: User | None) -> None:
    """Split billing is a property of a group: when this invoice raises it, revalidate the other
    members (which may have been processed before this invoice arrived) so all are held."""
    split = next((f for f in findings if f.code == "SPLIT_BILLING_SUSPECTED" and f.blocking), None)
    if split is None:
        return
    for rid in (split.data or {}).get("related_invoices", []):
        other = session.get(Invoice, rid)
        if other is None or other.lifecycle_state not in lc.REVALIDATABLE:
            continue
        if any(f.code == "SPLIT_BILLING_SUSPECTED" for f in latest_findings(session, other.id, other.current_version)):
            continue
        process(session, other, actor=actor, reason=f"related to possible split billing on {inv.id}", cascade=False)


def _cancel_scheduled(session: Session, inv: Invoice, actor: User | None, why: str) -> None:
    for p in session.scalars(select(Payment).where(Payment.invoice_id == inv.id, Payment.state == "SCHEDULED")):
        p.state = "CANCELLED"
        audit.record(session, actor=actor, action="payment.cancelled", object_type="payment", object_id=p.id,
                     object_version=p.invoice_version, invoice_id=inv.id, before="SCHEDULED", after="CANCELLED",
                     details={"reason": why})


def cancel_scheduled_payments(session: Session, inv: Invoice, actor: User | None, why: str) -> None:
    _cancel_scheduled(session, inv, actor, why)
