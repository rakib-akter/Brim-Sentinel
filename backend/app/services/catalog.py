"""Finding catalogue: plain-language copy (FR-10 "Why this matters / What happens next"),
dismissibility and case ownership. Hard holds are never dismissible; they clear only when the
underlying condition is fixed and deterministic revalidation passes."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FindingType:
    title: str
    why: str
    next_action: str
    dismissible: bool = False
    owner_role: str = "ap_clerk"


CATALOG: dict[str, FindingType] = {
    "EXTRACTION_INCOMPLETE": FindingType(
        "Some invoice details could not be read",
        "Paying from guessed numbers risks paying the wrong amount or supplier.",
        "Enter the missing fields from the original document (creates a new version)."),
    "PROMPT_INJECTION_TEXT": FindingType(
        "Invoice text contains instructions aimed at the system",
        "Documents are data, not commands. Instruction-like text can indicate a manipulation attempt.",
        "Review the document; a finance manager may dismiss with a reason. No state was changed.",
        dismissible=True, owner_role="finance_manager"),
    "UNKNOWN_VENDOR": FindingType(
        "Supplier is not in the vendor master",
        "Paying an unknown party is a common fraud pattern.",
        "Onboard the vendor (pending → approved by finance) and verify identity, then revalidate."),
    "VENDOR_INACTIVE": FindingType(
        "Supplier is on hold or inactive",
        "The vendor master says this supplier must not be paid right now.",
        "Confirm the vendor status with finance before continuing."),
    "VENDOR_PENDING_REVIEW": FindingType(
        "Supplier is still pending review",
        "New or unapproved suppliers need extra finance oversight.",
        "Finance manager approval is added to the chain (P05)."),
    "VENDOR_TAX_ID_MISMATCH": FindingType(
        "Supplier tax number differs from the vendor master",
        "A different GST/HST number can indicate an impostor invoice.",
        "Confirm supplier identity with the trusted contact on file.", dismissible=True, owner_role="finance_manager"),
    "DUPLICATE_VENDOR_IDENTITY": FindingType(
        "Supplier looks like another vendor record",
        "Near-identical vendor names with different bank accounts can be used to divert payments.",
        "Confirm which vendor record is legitimate; a finance manager may dismiss with evidence.",
        dismissible=True, owner_role="finance_manager"),
    "TOTALS_MISMATCH": FindingType(
        "Invoice arithmetic does not add up",
        "Line items, taxes and the total must reconcile before payment.",
        "Request a corrected invoice from the supplier."),
    "TAX_MISMATCH": FindingType(
        "Tax charged does not match the delivery province",
        "Incorrect tax cannot be fully recovered and may be a billing error.",
        "Request a corrected invoice from the supplier."),
    "TAX_UNVERIFIABLE": FindingType(
        "Tax could not be fully verified",
        "Some tax rules depend on information not on the invoice (e.g. goods vs services).",
        "Review the tax lines manually.", dismissible=True, owner_role="finance_manager"),
    "FX_RATE_MISSING": FindingType(
        "No exchange rate for the invoice date",
        "Approval limits are evaluated in CAD at the invoice-date rate.",
        "Add the official rate for that date, then revalidate."),
    "CURRENCY_UNSUPPORTED": FindingType(
        "Invoice currency is not supported", "Only CAD and USD can be converted.", "Contact the supplier."),
    "DUE_BEFORE_INVOICE_DATE": FindingType(
        "Due date is before the invoice date", "Inconsistent dates suggest an error or manipulation.",
        "Request a corrected invoice."),
    "INVOICE_DATE_IN_FUTURE": FindingType(
        "Invoice is dated after it was received", "Future-dated invoices are unusual and can hide duplicates.",
        "Confirm the date with the supplier; a finance manager may dismiss with a reason.",
        dismissible=True, owner_role="finance_manager"),
    "STALE_INVOICE_DATE": FindingType(
        "Invoice is much older than its receipt date", "Old invoices are often re-sent duplicates.",
        "Check payment history for this supplier."),
    "PO_MISSING": FindingType(
        "Purchase order required but missing",
        "This supplier is set up to require a PO (P13); paying without one bypasses spending approval.",
        "Obtain the PO number from the requester and add it (creates a new version)."),
    "PO_NOT_FOUND": FindingType("Referenced PO does not exist", "Unknown PO numbers cannot authorize spend.",
                                "Correct the PO number."),
    "PO_VENDOR_MISMATCH": FindingType("PO belongs to a different supplier",
                                      "A PO authorizes spend with one supplier only.", "Correct the PO number."),
    "PO_CLOSED": FindingType("PO is closed or cancelled", "Closed POs cannot fund new invoices.",
                             "Ask purchasing to reopen or issue a new PO."),
    "PO_OVER_BALANCE": FindingType(
        "Invoice exceeds the PO remaining balance",
        "Spending beyond the PO needs finance-manager approval (P12).",
        "Finance manager approval is added to the chain."),
    "CONTRACT_EXPIRED": FindingType(
        "Supplier contract has expired", "Rates and caps may no longer be agreed.",
        "Confirm a renewed contract; a finance manager may approve an exception with a reason.",
        dismissible=True, owner_role="finance_manager"),
    "CONTRACT_RATE_EXCEEDED": FindingType(
        "Charges exceed the contracted rate", "Overbilling against the agreed rate.",
        "Request a corrected invoice or record an approved exception.", dismissible=True, owner_role="finance_manager"),
    "FUEL_SURCHARGE_CAP_EXCEEDED": FindingType(
        "Fuel surcharge exceeds the contract cap", "The contract caps the fuel surcharge percentage.",
        "Request a corrected invoice or record an approved exception.", dismissible=True, owner_role="finance_manager"),
    "CONTRACT_CAP_EXCEEDED": FindingType(
        "Monthly not-to-exceed amount exceeded", "Total billing this month exceeds the contract ceiling.",
        "Review with the contract owner; finance may record an approved exception.",
        dismissible=True, owner_role="finance_manager"),
    "BANK_CHANGE_UNVERIFIED": FindingType(
        "Bank account changed and not yet verified",
        "Changed bank details are the most common way supplier payments are stolen. A matching vendor "
        "master does not prove the change is legitimate.",
        "Call the supplier on a contact already on file, record the verification, then have finance "
        "authorize the route.", owner_role="ap_clerk"),
    "BANK_DETAILS_MISMATCH": FindingType(
        "Remit-to bank account differs from the verified account",
        "Money would go to an account nobody has verified.",
        "Treat as a bank-change request: verify independently before any payment."),
    "PAYMENT_ROUTE_UNAVAILABLE": FindingType(
        "No verified payment route", "Payment needs a destination verified independently of the invoice.",
        "Verify a payment route for this supplier."),
    "DEPARTMENT_UNASSIGNED": FindingType(
        "No department could be determined", "The approval chain depends on the requesting department.",
        "Assign the department (creates a new version)."),
    "REQUESTER_TERMINATED": FindingType(
        "Requester has left the company",
        "The terminated user cannot act; their department manager owns questions and rework.",
        "Department manager handles follow-up."),
    "LOW_CODING_CONFIDENCE": FindingType(
        "Accounting codes need review", "Suggestions below 70% confidence require a person to confirm.",
        "Confirm or change the GL/department coding."),
    "DUPLICATE_INVOICE": FindingType(
        "This invoice was already received or paid", "Paying twice is a direct loss.",
        "Cancel this copy, or document why it is not a duplicate.", dismissible=True, owner_role="finance_manager"),
    "DUPLICATE_CANDIDATE": FindingType(
        "Possible duplicate invoice", "Similar invoices may be the same bill sent twice.",
        "Compare with the matching record; dismiss with a reason if legitimate.",
        dismissible=True, owner_role="finance_manager"),
    "CARD_PAID_DUPLICATE": FindingType(
        "May already have been paid by Brim card", "A card charge matches this supplier, amount and date.",
        "Inspect the card transaction/receipt; dismiss with evidence if unrelated.",
        dismissible=True, owner_role="finance_manager"),
    "CREDIT_NOTE": FindingType(
        "Credit note — reduces the amount owed", "Credit notes are never paid out.",
        "Recorded against the supplier balance."),
    "AMOUNT_UNUSUAL": FindingType(
        "Unusual amount for this supplier", "Review priority only — not a fraud probability and not a hold.",
        "Check the amount against the supplier's usual billing."),
    "NO_ELIGIBLE_APPROVER": FindingType(
        "No eligible approver under current policy", "Policy requires an independent approver for each step.",
        "Escalated to the controller/CFO for a documented decision.", owner_role="controller_admin"),
    "NO_ELIGIBLE_RELEASER": FindingType(
        "No eligible person can release this payment",
        "Everyone with release authority is also an approver; separation of duties (P11) forbids self-release.",
        "Escalated for a documented controller/CFO decision. Payment stays held — there is no override.",
        owner_role="controller_admin"),
}


def info(code: str) -> FindingType:
    return CATALOG.get(code, FindingType(code.replace("_", " ").title(), "", "Review."))
