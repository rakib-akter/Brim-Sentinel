import { createContext, useContext } from "react";

/**
 * Lets any evidence on the invoice page ask the document viewer to highlight where a value was
 * read. Highlighting happens only when the backend returned layout coordinates for that value.
 */
export interface DocumentFocus {
  focusKey: string | null;
  setFocusKey: (key: string | null) => void;
  /** Anchor keys that have coordinates on this document. */
  available: Set<string>;
}

export const DocumentFocusContext = createContext<DocumentFocus | null>(null);
export const useDocumentFocus = () => useContext(DocumentFocusContext);

type Ref = { type?: unknown; ref?: unknown };

/** The layout anchor a piece of evidence points at, if any. */
export function anchorKeyForEvidence(ref: unknown, invoiceId: string): string | null {
  if (!ref || typeof ref !== "object") return null;
  const { type, ref: id } = ref as Ref;
  if (typeof id !== "string") return null;
  if (type === "document_field") {
    if (id === "taxes") return "tax:0";
    if (id === "lines") return "line:1";
    return id;
  }
  if (type === "invoice_line") {
    const [inv, line] = id.split(":");
    return inv === invoiceId && line ? `line:${line}` : null;
  }
  if (type === "bank_change" || type === "payment_route") return "remit";
  return null;
}

/** The first anchor among a finding's evidence references. */
export function anchorKeyForRefs(refs: unknown[], invoiceId: string): string | null {
  for (const r of refs) {
    const k = anchorKeyForEvidence(r, invoiceId);
    if (k) return k;
  }
  return null;
}
