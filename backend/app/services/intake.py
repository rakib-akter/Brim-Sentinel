"""IntakeService (FR-01): classify each email and each attachment independently; one draft per
payable attachment; SHA-256 per file; non-payable and missing-document work items; idempotent
re-import keyed on (source email id, attachment SHA-256)."""
from __future__ import annotations

import hashlib
import json
import re

from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Unprocessable
from app.db.models import Document, EmailMessage, IntakeItem, Invoice, User
from app.services import audit

_STATEMENT = re.compile(r"statement of account|relevé de compte", re.I)
_INQUIRY = re.compile(r"where is (our )?payment|payment status|not (yet )?received (our )?payment|paiement", re.I)
_CLAIMS_ATTACHMENT = re.compile(r"attached|ci-joint|pi[eè]ce jointe|enclosed", re.I)
_INVOICE_WORD = re.compile(r"invoice|facture", re.I)

ALLOWED_TYPES = {".pdf": ("application/pdf", b"%PDF"), ".png": ("image/png", b"\x89PNG"),
                 ".jpg": ("image/jpeg", b"\xff\xd8\xff"), ".jpeg": ("image/jpeg", b"\xff\xd8\xff")}


def classify_email(em: dict[str, Any]) -> tuple[str, str]:
    subject, body = em.get("subject") or "", em.get("body") or ""
    text = f"{subject}\n{body}"
    if em.get("attachments"):
        return "ap_document", "Email carries attachment(s); each attachment is classified separately."
    if _STATEMENT.search(text):
        return "statement", "Statement of account: informational, not a payable bill."
    if _INQUIRY.search(text):
        return "payment_inquiry", "Supplier payment inquiry: route to AP for a reply, no bill created."
    if _INVOICE_WORD.search(text) and _CLAIMS_ATTACHMENT.search(text):
        return "missing_document", "Email says an invoice is attached but no file was received."
    return "non_ap", "No invoice content (e.g. marketing); not payable."


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _doc_id(source_ref: str, sha: str) -> str:
    return "DOC-" + hashlib.sha256(f"{source_ref}|{sha}".encode()).hexdigest()[:12].upper()


def import_inbox(session: Session, actor: User | None) -> dict[str, int]:
    from app.services import pipeline

    data_dir = get_settings().data_dir
    emails = json.loads((data_dir / "inbox" / "emails.json").read_text(encoding="utf-8"))
    created = existing = items = 0
    for em in sorted(emails, key=lambda e: (e.get("received_at") or "", e["email_id"])):
        if session.get(EmailMessage, em["email_id"]) is None:
            cls, why = classify_email(em)
            session.add(EmailMessage(id=em["email_id"], from_name=em.get("from_name"),
                                     from_address=em.get("from_address"), to_address=em.get("to_address"),
                                     subject=em.get("subject"), received_at=em.get("received_at"),
                                     body=em.get("body"), attachments=em.get("attachments") or [],
                                     classification=cls, classification_reason=why))
            session.flush()
            audit.record(session, actor=actor, action="intake.email_classified", object_type="email",
                         object_id=em["email_id"], after=cls, details={"reason": why})
            if cls != "ap_document":
                item_id = f"II-{em['email_id']}"
                if session.get(IntakeItem, item_id) is None:
                    session.add(IntakeItem(id=item_id, email_id=em["email_id"], document_id=None, item_type=cls,
                                           payable=False, invoice_id=None,
                                           status="OPEN" if cls in {"missing_document", "payment_inquiry"} else "CLOSED",
                                           note=why))
                    items += 1
        for n, fname in enumerate(em.get("attachments") or [], start=1):
            path = data_dir / "incoming_invoices" / fname
            if not path.exists():
                item_id = f"II-{em['email_id']}-{n}"
                if session.get(IntakeItem, item_id) is None:
                    session.add(IntakeItem(id=item_id, email_id=em["email_id"], item_type="missing_document",
                                           payable=False, status="OPEN",
                                           note=f"Attachment '{fname}' listed but file not found in batch."))
                    items += 1
                continue
            sha = sha256_file(path)
            doc_id = _doc_id(em["email_id"], sha)
            if session.get(Document, doc_id) is not None:
                existing += 1
                continue
            ext = path.suffix.lower()
            session.add(Document(id=doc_id, source_ref=em["email_id"], filename=fname, sha256=sha,
                                 size_bytes=path.stat().st_size,
                                 mime_type=ALLOWED_TYPES.get(ext, ("application/octet-stream", b""))[0],
                                 storage_path=str(path)))
            session.flush()
            invoice_id = f"IN-{em['email_id']}-{n}"
            pipeline.create_from_document(session, invoice_id=invoice_id, document_id=doc_id,
                                          email_id=em["email_id"], source_kind="email_intake", actor=actor,
                                          received_date=(em.get("received_at") or "")[:10] or None)
            created += 1
    session.flush()
    return {"emails": len(emails), "drafts_created": created, "attachments_already_imported": existing,
            "work_items_created": items}


def store_upload(session: Session, *, actor: User, filename: str, content: bytes) -> tuple[Document, bool]:
    settings = get_settings()
    safe = Path(filename or "upload").name  # strips any directory traversal
    safe = re.sub(r"[^\w.\- ]", "_", safe)[:120] or "upload"
    ext = Path(safe).suffix.lower()
    if ext not in ALLOWED_TYPES:
        raise Unprocessable("UNSUPPORTED_FILE_TYPE", "Only PDF, PNG or JPEG invoices are accepted.", {"filename": safe})
    if len(content) == 0 or len(content) > settings.max_upload_bytes:
        raise Unprocessable("FILE_SIZE_INVALID", "File is empty or larger than the 10 MB limit.",
                            {"size_bytes": len(content)})
    mime, magic = ALLOWED_TYPES[ext]
    if not content.startswith(magic):
        raise Unprocessable("FILE_CONTENT_MISMATCH", "File content does not match its extension.", {"filename": safe})
    sha = hashlib.sha256(content).hexdigest()
    source_ref = f"upload:{actor.id}"
    doc_id = _doc_id(source_ref, sha)
    existing = session.get(Document, doc_id)
    if existing is not None:
        return existing, False
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.upload_dir / f"{sha}{ext}"
    dest.write_bytes(content)
    doc = Document(id=doc_id, source_ref=source_ref, filename=safe, sha256=sha, size_bytes=len(content),
                   mime_type=mime, storage_path=str(dest))
    session.add(doc)
    session.flush()
    return doc, True


def find_invoice_for_document(session: Session, document_id: str) -> Invoice | None:
    return session.scalar(select(Invoice).where(Invoice.document_id == document_id))



