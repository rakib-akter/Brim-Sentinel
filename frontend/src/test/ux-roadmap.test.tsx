import { describe, expect, it } from "vitest";
import type { FlightRecorderOut, InvoiceDetail } from "@/lib/api/schema";
import { buildDecisionGraph, stageOfEvent } from "@/lib/graph/decision-graph";
import { buildRelationshipGraph } from "@/lib/graph/relationship-graph";
import { codingSource, toPct } from "@/components/sentinel/ml-coding";
import { investigationMode } from "@/components/sentinel/investigate-panel";
import { anchorKeyForEvidence } from "@/lib/document-focus";

const finding = (over: Partial<InvoiceDetail["validation_findings"][number]>) => ({
  id: "F1",
  invoice_id: "IN-1",
  version: 1,
  check: "bank",
  code: "BANK_CHANGE_UNVERIFIED",
  result: "FAIL" as const,
  severity: "high",
  blocking: true,
  dismissible: false,
  title: "Bank account changed and not yet verified",
  rationale: "r",
  why_it_matters: "w",
  next_action: null,
  policy_ids: [],
  evidence_refs: [{ type: "bank_change", ref: "BC-009", label: "email" }],
  data: {},
  dismissed_by: null,
  dismissal_reason: null,
  ...over,
});

function record(over: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: "IN-1",
    invoice_number: "1624",
    vendor_id: "V004",
    vendor_name: "Cascadia Cartage Ltd.",
    version: 1,
    row_version: 1,
    kind: "invoice",
    currency: "CAD",
    amount_minor: 100,
    amount_cad_minor: 100,
    invoice_date: "2026-10-24",
    due_date: "2026-11-23",
    lifecycle_state: "ON_HOLD",
    plain_status: "Payment paused",
    risk_band: "high",
    risk_score: "0.7",
    blocking_findings_count: 1,
    allowed_actions: ["revalidate"],
    blocked_reasons: ["Bank account changed and not yet verified"],
    source_kind: "email",
    department_id: null,
    requester_id: null,
    owner: null,
    primary_action: { kind: "review_bank_details", label: "Review bank details" },
    provenance: "ocr",
    language: "en",
    document_refs: [],
    extracted_fields: {},
    uncertain_fields: [],
    line_items: [],
    taxes: [],
    subtotal_minor: null,
    fx: null,
    remit: {
      method: "EFT",
      account_masked: "****9679",
      route: { id: "RT-V004-EFT", status: "UNVERIFIED", provenance: "bank change BC-009" },
    },
    validation_findings: [finding({})],
    duplicate_candidates: [],
    approval_chain: [],
    eligible_releasers: [],
    resolution_cases: [],
    payment_summary: null,
    anomaly: null,
    versions: [],
    evidence_refs: [],
    ...over,
  };
}

const ev = (id: string, action: string, after: string | null = null) => ({
  kind: "persisted" as const,
  id,
  occurred_at: "2026-11-22T05:25:23",
  actor_id: null,
  actor_name: "Sentinel (system)",
  action,
  label: action,
  before_state: null,
  after_state: after,
  result: "SUCCESS",
  policy_ids: [],
  evidence_refs: [],
});

const flight: FlightRecorderOut = {
  invoice_id: "IN-1",
  as_of: "2026-11-22",
  events: [
    ev("1", "invoice.received", "RECEIVED"),
    ev("2", "invoice.extracted"),
    ev("3", "invoice.transition", "CODED"),
    ev("4", "invoice.transition", "ON_HOLD"),
    ev("5", "case.opened", "AWAITING_VERIFICATION"),
  ],
  proposed_next: [
    {
      ...ev("C:callback", "callback"),
      kind: "proposed",
      occurred_at: null,
      actor_name: "ap_clerk",
      label: "Not yet happened — Call the supplier",
    },
    {
      ...ev("C:release", "release"),
      kind: "proposed",
      occurred_at: null,
      actor_name: "finance_manager",
      label: "Not yet happened — Release",
    },
  ],
};

describe("decision graph", () => {
  it("maps audit events to stages", () => {
    expect(stageOfEvent({ action: "invoice.transition", after_state: "ON_HOLD" })).toBe("hold");
    expect(stageOfEvent({ action: "payment.simulated_settled", after_state: null })).toBe(
      "payment",
    );
    expect(stageOfEvent({ action: "investigation.lookup", after_state: null })).toBe(
      "investigation",
    );
  });

  it("draws recorded edges solid and Path to Pay steps as proposed", () => {
    const g = buildDecisionGraph(record(), flight);
    const hold = g.nodes.find((n) => n.stage === "hold")!;
    expect(hold.isHoldReason).toBe(true);
    expect(hold.status).toBe("blocked");
    expect(g.focusId).toBe(hold.id);
    const proposed = g.nodes.filter((n) => n.basis === "proposed");
    expect(proposed.map((n) => n.label)).toEqual(["Call the supplier", "Release"]);
    // Proposed steps hang off the hold, never off a settled payment.
    expect(g.edges.find((e) => e.target === proposed[0]!.id)).toMatchObject({
      source: "hold",
      kind: "proposed",
    });
    expect(
      g.edges.filter((e) => e.kind === "recorded").every((e) => !e.target.startsWith("proposed:")),
    ).toBe(true);
  });

  it("never invents investigation, verification or payment nodes", () => {
    const g = buildDecisionGraph(record(), flight);
    const stages = g.nodes.filter((n) => n.basis !== "proposed").map((n) => n.stage);
    expect(stages).not.toContain("investigation");
    expect(stages).not.toContain("verification");
    expect(stages).not.toContain("payment");
  });
});

describe("relationship graph", () => {
  it("distinguishes confirmed relationships from possible matches", () => {
    const g = buildRelationshipGraph(
      record({
        duplicate_candidates: [
          {
            id: "D1",
            match_type: "FUZZY",
            confirmed: false,
            score: 82,
            matched_invoice_id: "AP-1",
            matched_card_txn_id: null,
            reasons: ["Same total"],
          },
        ],
        validation_findings: [
          finding({}),
          finding({
            id: "F2",
            code: "DUPLICATE_VENDOR_IDENTITY",
            blocking: false,
            evidence_refs: [{ type: "vendor", ref: "V052", label: "Look-alike" }],
          }),
        ],
      }),
    );
    expect(g.edges.find((e) => e.target === "invoice:AP-1")?.certainty).toBe("possible");
    expect(g.edges.find((e) => e.target === "vendor:V052")?.certainty).toBe("possible");
    expect(g.edges.find((e) => e.source === "bank_change:BC-009")).toMatchObject({
      certainty: "confirmed",
      label: "holds payment",
    });
    expect(g.nodes.find((n) => n.id === "route:RT-V004-EFT")?.tone).toBe("risk");
  });
});

describe("ML provenance and confidence", () => {
  it("labels model, fallback, human and unknown sources", () => {
    expect(
      codingSource({ coding_method: "tfidf_logreg_v1", coding_status: "SUGGESTED" }).kind,
    ).toBe("model");
    expect(
      codingSource({ coding_method: "knn_rapidfuzz_v1", coding_status: "SUGGESTED" }).label,
    ).toBe("Rule-based fallback");
    expect(
      codingSource({ coding_method: "tfidf_logreg_v1", coding_status: "OVERRIDDEN" }).kind,
    ).toBe("human");
    expect(codingSource({ coding_method: null, coding_status: null }).label).toBe(
      "Source unavailable",
    );
  });
  it("shows confidence only when the backend supplied it", () => {
    expect(toPct(null)).toBeNull();
    expect(toPct("0.69")).toBe(69);
    expect(toPct("1.0")).toBe(100);
  });
});

describe("AI investigation labeling", () => {
  it("labels live, recorded and deterministic runs from backend fields", () => {
    expect(investigationMode({ source: "model", replayed: false }).label).toBe("Live AI");
    expect(investigationMode({ source: "model", replayed: true }).label).toBe("Recorded demo");
    expect(investigationMode({ source: "deterministic_template", replayed: null }).label).toBe(
      "Deterministic fallback",
    );
  });
});

describe("evidence → document region", () => {
  it("maps only references that have a document position", () => {
    expect(anchorKeyForEvidence({ type: "document_field", ref: "taxes" }, "IN-1")).toBe("tax:0");
    expect(anchorKeyForEvidence({ type: "invoice_line", ref: "IN-1:4" }, "IN-1")).toBe("line:4");
    expect(anchorKeyForEvidence({ type: "invoice_line", ref: "OTHER:4" }, "IN-1")).toBeNull();
    expect(anchorKeyForEvidence({ type: "bank_change", ref: "BC-9" }, "IN-1")).toBe("remit");
    expect(anchorKeyForEvidence({ type: "contract", ref: "C1" }, "IN-1")).toBeNull();
  });
});
