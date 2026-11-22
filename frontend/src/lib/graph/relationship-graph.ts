/**
 * Financial Relationship Graph model for one invoice. Every node and edge comes from a record the
 * invoice API already returned: the vendor, its payment route and provenance, duplicate candidates,
 * contract and bank-change references cited by checks, and a simulated payment if one exists.
 * "Confirmed" relationships are drawn solid; "possible match" relationships are dashed.
 */
import type { InvoiceDetail as InvoiceRecord } from "@/lib/api/schema";

export type RelKind = "vendor" | "route" | "bank_change" | "duplicate" | "contract" | "payment";
export type EntityKind =
  | "invoice"
  | "vendor"
  | "route"
  | "bank_change"
  | "matched_invoice"
  | "card_transaction"
  | "contract"
  | "payment";

export interface RelNode {
  id: string;
  kind: EntityKind;
  label: string;
  detail: string;
  tone: "neutral" | "risk" | "ok" | "warn";
  /** Internal link target when the user may open it. */
  link?: { to: "invoice"; invoiceId: string } | { to: "vendor"; vendorId: string } | undefined;
  facts: Array<[string, string]>;
}

export interface RelEdge {
  id: string;
  source: string;
  target: string;
  kind: RelKind;
  label: string;
  certainty: "confirmed" | "possible";
}

export const REL_LABEL: Record<RelKind, string> = {
  vendor: "Supplier",
  route: "Payment route",
  bank_change: "Bank changes",
  duplicate: "Duplicates",
  contract: "Contracts",
  payment: "Payment",
};

/** Maximum entities drawn at once, to keep the picture readable. */
export const MAX_NODES = 14;

type Ref = { type?: unknown; ref?: unknown; label?: unknown };

export function buildRelationshipGraph(record: InvoiceRecord) {
  const nodes = new Map<string, RelNode>();
  const edges: RelEdge[] = [];
  const add = (n: RelNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const link = (e: RelEdge) => {
    if (!edges.some((x) => x.id === e.id)) edges.push(e);
  };
  const inv = `invoice:${record.id}`;
  add({
    id: inv,
    kind: "invoice",
    label: record.invoice_number ? `Invoice #${record.invoice_number}` : record.id,
    detail: record.lifecycle_state === "ON_HOLD" ? "Payment on hold" : "This invoice",
    tone: record.lifecycle_state === "ON_HOLD" ? "risk" : "neutral",
    facts: [
      ["Record", record.id],
      ["Status", record.plain_status],
    ],
  });

  // Supplier on the invoice.
  const vendorNode = record.vendor_id ? `vendor:${record.vendor_id}` : null;
  if (vendorNode && record.vendor_id) {
    add({
      id: vendorNode,
      kind: "vendor",
      label: record.vendor_name ?? record.vendor_id,
      detail: "Supplier on the invoice",
      tone: "neutral",
      link: { to: "vendor", vendorId: record.vendor_id },
      facts: [["Vendor ID", record.vendor_id]],
    });
    link({
      id: `${inv}-${vendorNode}`,
      source: vendorNode,
      target: inv,
      kind: "vendor",
      label: "billed by",
      certainty: "confirmed",
    });
  }

  // Payment route on the invoice and its provenance.
  const route = record.remit["route"] as Record<string, unknown> | undefined;
  if (route && typeof route["id"] === "string") {
    const verified = route["status"] === "VERIFIED";
    const id = `route:${route["id"]}`;
    add({
      id,
      kind: "route",
      label:
        `${String(record.remit["method"] ?? "Route")} ${String(record.remit["account_masked"] ?? "")}`.trim(),
      detail: verified ? "Verified payment route" : "Unverified payment route",
      tone: verified ? "ok" : "risk",
      facts: [
        ["Route", String(route["id"])],
        ["Status", verified ? "Verified" : "Not verified"],
        ["Provenance", String(route["provenance"] ?? "Not recorded")],
      ],
    });
    link({
      id: `${inv}-${id}`,
      source: inv,
      target: id,
      kind: "route",
      label: "would pay to",
      certainty: "confirmed",
    });
    if (vendorNode)
      link({
        id: `${vendorNode}-${id}`,
        source: vendorNode,
        target: id,
        kind: "route",
        label: "route on file",
        certainty: "confirmed",
      });
  }

  // References cited by failing checks: bank changes, contracts, look-alike vendors, invoices.
  for (const f of record.validation_findings) {
    if (f.result !== "FAIL") continue;
    for (const raw of f.evidence_refs as Ref[]) {
      const type = String(raw.type ?? "");
      const ref = typeof raw.ref === "string" ? raw.ref : null;
      if (!ref) continue;
      const label = typeof raw.label === "string" ? raw.label : "";
      if (type === "bank_change") {
        const id = `bank_change:${ref}`;
        add({
          id,
          kind: "bank_change",
          label: `Bank change ${ref}`,
          detail: f.title,
          tone: f.blocking ? "risk" : "warn",
          facts: [
            ["Request", label || "Not described"],
            ["Check", f.title],
          ],
        });
        if (vendorNode)
          link({
            id: `${vendorNode}-${id}`,
            source: vendorNode,
            target: id,
            kind: "bank_change",
            label: "change requested",
            certainty: "confirmed",
          });
        link({
          id: `${id}-${inv}`,
          source: id,
          target: inv,
          kind: "bank_change",
          label: f.blocking ? "holds payment" : "flagged",
          certainty: "confirmed",
        });
      } else if (type === "contract") {
        const id = `contract:${ref}`;
        add({
          id,
          kind: "contract",
          label: `Contract ${ref}`,
          detail: label || "Contract terms",
          tone: f.blocking ? "risk" : "warn",
          facts: [
            ["Contract", ref],
            ["Check", f.title],
            ["Why it matters", f.why_it_matters ?? f.rationale],
          ],
        });
        link({
          id: `${inv}-${id}`,
          source: inv,
          target: id,
          kind: "contract",
          label: "checked against",
          certainty: "confirmed",
        });
      } else if (type === "vendor" && ref !== record.vendor_id) {
        const id = `vendor:${ref}`;
        add({
          id,
          kind: "vendor",
          label: label || ref,
          detail: "Look-alike supplier record",
          tone: "warn",
          link: { to: "vendor", vendorId: ref },
          facts: [
            ["Vendor ID", ref],
            ["Check", f.title],
          ],
        });
        if (vendorNode)
          link({
            id: `${vendorNode}-${id}`,
            source: vendorNode,
            target: id,
            kind: "vendor",
            label: "looks like",
            certainty: "possible",
          });
      }
    }
  }

  // Duplicate candidates: confirmed vs candidate.
  for (const d of record.duplicate_candidates) {
    const target = d.matched_invoice_id
      ? `invoice:${d.matched_invoice_id}`
      : d.matched_card_txn_id
        ? `card:${d.matched_card_txn_id}`
        : null;
    if (!target) continue;
    const card = !d.matched_invoice_id;
    add({
      id: target,
      kind: card ? "card_transaction" : "matched_invoice",
      label: card ? `Card charge ${d.matched_card_txn_id}` : `Invoice ${d.matched_invoice_id}`,
      detail: d.confirmed ? "Confirmed duplicate" : "Possible duplicate",
      tone: d.confirmed ? "risk" : "warn",
      link: d.matched_invoice_id ? { to: "invoice", invoiceId: d.matched_invoice_id } : undefined,
      facts: [
        ["Match", `${d.match_type.toLowerCase().replaceAll("_", " ")} · score ${d.score}`],
        ...d.reasons.map((r, i) => [i === 0 ? "Reasons" : "", r] as [string, string]),
      ],
    });
    link({
      id: `${inv}-${target}`,
      source: inv,
      target,
      kind: "duplicate",
      label: d.confirmed ? "duplicate of" : "may duplicate",
      certainty: d.confirmed ? "confirmed" : "possible",
    });
  }

  // Simulated payment.
  const pay = record.payment_summary;
  if (pay) {
    const id = `payment:${pay.id}`;
    add({
      id,
      kind: "payment",
      label: `Simulated ${pay.method}`,
      detail: pay.state.toLowerCase().replaceAll("_", " "),
      tone: pay.state === "FAILED" ? "risk" : "ok",
      facts: [
        ["Payment", pay.id],
        ["State", pay.state],
        ["Simulation", "Yes, no real money moved"],
      ],
    });
    link({
      id: `${inv}-${id}`,
      source: inv,
      target: id,
      kind: "payment",
      label: "paid by",
      certainty: "confirmed",
    });
  }

  const all = [...nodes.values()];
  const capped = all.slice(0, MAX_NODES);
  const keep = new Set(capped.map((n) => n.id));
  return {
    center: inv,
    nodes: capped,
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    hidden: all.length - capped.length,
  };
}

/**
 * Layout: invoice in the middle, its supplier above with any look-alike suppliers beside it, and
 * everything else spread over the lower half so no edge passes through the invoice.
 */
export function layoutRelationshipGraph(
  nodes: RelNode[],
  center: string,
  radius = 260,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  pos.set(center, { x: 0, y: 0 });
  const supplier = nodes.find((n) => n.detail === "Supplier on the invoice");
  if (supplier) pos.set(supplier.id, { x: 0, y: -radius * 0.85 });
  const lookalikes = nodes.filter((n) => n.kind === "vendor" && n !== supplier && n.id !== center);
  lookalikes.forEach((n, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    pos.set(n.id, { x: side * radius * 1.35 * (1 + Math.floor(i / 2) * 0.8), y: -radius * 0.85 });
  });
  const rest = nodes.filter((n) => !pos.has(n.id));
  rest.forEach((n, i) => {
    // Angles from right (0) through bottom to left (π).
    const angle = rest.length === 1 ? Math.PI / 2 : (i * Math.PI) / (rest.length - 1);
    pos.set(n.id, {
      x: Math.round(Math.cos(angle) * radius * 1.35),
      y: Math.round(Math.sin(angle) * radius * 0.75),
    });
  });
  return pos;
}
