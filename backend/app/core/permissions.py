"""Server-side role permissions. The browser is never authoritative: every mutating service
re-checks the acting user's role, status, scope and segregation of duties.

Dataset roles: controller_admin, finance_manager, ap_clerk, auditor, approver, employee.
`service_ai` is the Sentinel service identity: zero approve/verify/release/policy-edit permissions."""
from __future__ import annotations

from app.core.errors import Forbidden
from app.db.models import Invoice, InvoiceVersion, User

PERMISSIONS: dict[str, set[str]] = {
    "intake.import": {"ap_clerk", "controller_admin"},
    "invoice.upload": {"ap_clerk", "employee", "approver", "finance_manager", "controller_admin"},
    "invoice.edit": {"ap_clerk", "finance_manager", "controller_admin"},
    "invoice.revalidate": {"ap_clerk", "finance_manager", "controller_admin"},
    "invoice.coding_decision": {"ap_clerk", "finance_manager", "controller_admin"},
    "finding.dismiss": {"finance_manager", "controller_admin"},
    "payment.prepare": {"ap_clerk", "finance_manager", "controller_admin"},
    "payment.release": {"finance_manager", "controller_admin"},
    "payment.settle_simulation": {"finance_manager", "controller_admin"},
    "bank_change.request": {"ap_clerk", "finance_manager", "controller_admin"},
    "bank_change.verify": {"ap_clerk", "finance_manager", "controller_admin"},
    "bank_change.authorize": {"finance_manager", "controller_admin"},
    "case.update": {"ap_clerk", "finance_manager", "controller_admin"},
    "case.authorization_request": {"ap_clerk", "finance_manager", "controller_admin"},
    "vendor.activate": {"finance_manager", "controller_admin"},
    # §6.2 virtual-card rerouting: registration and independent verification of a card route,
    # then a method change that only a finance manager may authorize (PRD wizard step 3).
    "card_route.register": {"ap_clerk", "finance_manager", "controller_admin"},
    "card_route.verify": {"ap_clerk", "finance_manager", "controller_admin"},
    "payment_method.request": {"ap_clerk", "finance_manager", "controller_admin"},
    "payment_method.authorize": {"finance_manager"},
    "vendor.onboard_request": {"ap_clerk", "finance_manager", "controller_admin"},
    "audit.read_all": {"auditor", "controller_admin", "finance_manager"},
    "audit.export": {"auditor", "controller_admin"},
}

GLOBAL_READ_ROLES = {"ap_clerk", "finance_manager", "controller_admin", "auditor"}


def require(actor: User, permission: str) -> None:
    if actor.kind != "human":
        raise Forbidden("SERVICE_IDENTITY_NOT_PERMITTED", "Service/AI identities cannot perform this action.",
                        {"permission": permission})
    if actor.status != "active":
        raise Forbidden("ACTOR_NOT_ACTIVE", f"User {actor.id} is {actor.status} and cannot act.",
                        {"status": actor.status})
    if actor.role not in PERMISSIONS.get(permission, set()):
        raise Forbidden("ROLE_NOT_PERMITTED", f"Role '{actor.role}' cannot perform '{permission}'.",
                        {"permission": permission, "role": actor.role})


def has(actor: User, permission: str) -> bool:
    return actor.kind == "human" and actor.status == "active" and actor.role in PERMISSIONS.get(permission, set())


def can_view_invoice(actor: User, invoice: Invoice, version: InvoiceVersion | None,
                     assigned_actor_ids: set[str] | None = None) -> bool:
    if actor.role in GLOBAL_READ_ROLES or actor.role == "service_ai":
        return True
    if version is None:
        return False
    if actor.role == "approver":
        return version.department_id == actor.department_id or actor.id in (assigned_actor_ids or set())
    if actor.role == "employee":
        return version.requester_id == actor.id
    return False
