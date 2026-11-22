/**
 * Decision Graph model: turns the persisted audit events (Flight Recorder) and the current invoice
 * record into a small set of stage nodes and edges.
 *
 * Rules that keep the graph truthful:
 * - A "recorded" node exists only when the audit trail or the current record shows it happened.
 * - "Proposed" nodes come only from the backend's own Path to Pay (`proposed_next`) or from steps
 *   the record says are still waiting (e.g. a pending approval). They are drawn dashed.
 * - Nothing is inferred about money movement: a payment node is recorded only when the backend
 *   returns a payment; settlement is always labelled simulated.
 */
import type {
  FlightEvent,
  FlightRecorderOut,
  FindingOut,
  InvoiceDetail as InvoiceRecord,
} from "@/lib/api/schema";

export type StageKey =
  | "intake"
  | "extraction"
  | "coding"
  | "validation"
  | "hold"
  | "investigation"
  | "verification"
  | "approval"
  | "payment"
  | "audit";

export type NodeStatus = "completed" | "blocked" | "pending" | "proposed" | "failed";

export interface GraphNodeModel {
  id: string;
  stage: StageKey;
  label: string;
  /** One plain-language line under the label. */
  summary: string;
  status: NodeStatus;
  /** "recorded" = audit events exist; "record" = current record state only; "proposed" = not yet. */
  basis: "recorded" | "record" | "proposed";
  actor: string | null;
  at: string | null;
  events: FlightEvent[];
  findings: FindingOut[];
  /** Why this node matters, in plain words (shown in the drawer and on hover). */
  rationale: string | null;
  /** True for the node that explains why the invoice is currently held. */
  isHoldReason?: boolean;
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  kind: "recorded" | "proposed";
  /** Part of the path that leads to the current state (highlighted). */
  active: boolean;
}

export interface DecisionGraphModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
  /** The node id the viewer should focus first (the hold, or the current step). */
  focusId: string | null;
}

export const STAGE_LABEL: Record<StageKey, string> = {
  intake: "Intake",
  extraction: "Extraction",
  coding: "ML coding",
  validation: "Validation",
  hold: "Hold",
  investigation: "Investigation",
  verification: "Verification",
  approval: "Approval",
  payment: "Simulated payment",
  audit: "Audit trail",
};

const STAGE_ORDER: StageKey[] = [
  "intake",
  "extraction",
  "coding",
  "validation",
  "hold",
  "investigation",
  "verification",
  "approval",
  "payment",
  "audit",
];

/** Which stage a persisted audit event belongs to. Unknown actions fall into the audit trail. */
export function stageOfEvent(e: Pick<FlightEvent, "action" | "after_state">): StageKey {
  const a = e.action;
  if (a === "invoice.transition") {
    switch (e.after_state) {
      case "RECEIVED":
      case "DRAFT":
        return "intake";
      case "EXTRACTED":
        return "extraction";
      case "CODED":
        return "coding";
      case "VALIDATED":
        return "validation";
      case "ON_HOLD":
        return "hold";
      case "PENDING_APPROVAL":
      case "APPROVED":
      case "REJECTED":
        return "approval";
      case "SCHEDULED":
      case "RELEASED":
      case "SETTLED":
      case "FAILED":
        return "payment";
      default:
        return "audit";
    }
  }
  if (/^(invoice\.received|intake\.)/.test(a)) return "intake";
  if (/^(invoice\.extracted|invoice\.edit|invoice\.version_created|brim\.ocr)/.test(a))
    return "extraction";
  if (/^(coding\.|invoice\.coding_decision)/.test(a)) return "coding";
  if (/^(invoice\.validated|invoice\.revalidate|finding\.)/.test(a)) return "validation";
  if (/^case\.(opened|resolved|rejected|cancelled|update)/.test(a)) return "hold";
  if (/^investigation\./.test(a)) return "investigation";
  if (/^(bank_change\.|card_route\.|payment_method\.|vendor\.)/.test(a)) return "verification";
  if (/^(approval\.|approvals\.|case\.authorization)/.test(a)) return "approval";
  if (/^payment\./.test(a)) return "payment";
  return "audit";
}

/** Which stage a backend Path to Pay step key belongs to. */
export function stageOfProposed(key: string): StageKey {
  if (["callback", "route_authorization", "verify", "onboard", "activate"].includes(key))
    return "verification";
  if (key === "revalidate") return "validation";
  if (key === "approvals") return "approval";
  if (key === "release") return "payment";
  return "hold"; // inspect, determination, compare, correct, fix, escalate… resolve the hold
}

const ROLE_LABEL: Record<string, string> = {
  ap_clerk: "AP clerk",
  finance_manager: "Finance manager",
  controller_admin: "Controller",
  approver: "Required approvers",
  dept_manager: "Department manager",
  system: "Sentinel (system)",
  "finance_manager/controller_admin": "Finance manager or controller",
};
export const roleLabel = (r: string | null | undefined) =>
  r ? (ROLE_LABEL[r] ?? r.replaceAll("_", " ")) : null;

const ON_HOLD_STATES = new Set(["ON_HOLD"]);

export function buildDecisionGraph(
  record: InvoiceRecord,
  flight: FlightRecorderOut | undefined,
): DecisionGraphModel {
  const events = flight?.events ?? [];
  const byStage = new Map<StageKey, FlightEvent[]>();
  for (const e of events) {
    const s = stageOfEvent(e);
    byStage.set(s, [...(byStage.get(s) ?? []), e]);
  }
  const failing = record.validation_findings.filter((f) => f.result === "FAIL" && !f.dismissed_by);
  const blocking = failing.filter((f) => f.blocking);
  const onHold = ON_HOLD_STATES.has(record.lifecycle_state);
  const nodes: GraphNodeModel[] = [];
  const last = (list: FlightEvent[]) => list[list.length - 1];
  const recorded = (stage: StageKey, extra: Partial<GraphNodeModel>): void => {
    const list = byStage.get(stage) ?? [];
    const tail = last(list);
    nodes.push({
      id: stage,
      stage,
      label: STAGE_LABEL[stage],
      summary: "",
      status: "completed",
      basis: list.length ? "recorded" : "record",
      actor: tail?.actor_name ?? null,
      at: tail?.occurred_at ?? null,
      events: list,
      findings: [],
      rationale: null,
      ...extra,
    });
  };

  // Intake and extraction: always present once a record exists.
  recorded("intake", { summary: `Received · ${record.source_kind.replaceAll("_", " ")}` });
  recorded("extraction", {
    summary:
      record.uncertain_fields.length > 0
        ? `${record.uncertain_fields.length} field(s) need a person`
        : `Read ${record.provenance === "ocr" ? "by OCR" : record.provenance === "pdf_text" ? "from PDF text" : "from source"}`,
    status: record.uncertain_fields.length > 0 ? "pending" : "completed",
  });

  // ML coding: from the line items the record holds.
  if (record.line_items.length > 0) {
    const review = record.line_items.filter((l) => l.coding_status === "NEEDS_REVIEW").length;
    const decided = record.line_items.filter((l) =>
      ["CONFIRMED", "OVERRIDDEN"].includes(l.coding_status ?? ""),
    ).length;
    recorded("coding", {
      summary: review
        ? `${review} line(s) need a person`
        : decided === record.line_items.length
          ? "All lines confirmed by a person"
          : `${record.line_items.length} line(s) suggested by ML`,
      status: review ? "pending" : "completed",
      rationale:
        "The ML model suggests accounting codes. A suggestion is not an approval; a person confirms or changes it.",
    });
  }

  // Validation.
  const unknown = record.validation_findings.filter((f) => f.result === "UNKNOWN").length;
  recorded("validation", {
    summary: blocking.length
      ? `${blocking.length} blocking check${blocking.length === 1 ? "" : "s"} failed`
      : failing.length
        ? `${failing.length} advisory finding${failing.length === 1 ? "" : "s"}`
        : unknown
          ? `${unknown} check(s) couldn't be confirmed`
          : "All checks passed",
    status: blocking.length ? "blocked" : "completed",
    findings: failing,
  });

  // Hold: only if the invoice is or was held, or a resolution case exists.
  const wasHeld = (byStage.get("hold") ?? []).length > 0 || record.resolution_cases.length > 0;
  if (onHold || wasHeld) {
    const openCases = record.resolution_cases.filter(
      (c) => !["RESOLVED", "REJECTED", "CANCELLED"].includes(c.state),
    );
    recorded("hold", {
      label: onHold ? "Payment on hold" : "Hold resolved",
      summary: onHold
        ? (blocking[0]?.title ?? record.blocked_reasons[0] ?? "Payment paused")
        : "Resolution case closed",
      status: onHold ? "blocked" : "completed",
      findings: blocking,
      actor: openCases[0] ? roleLabel(openCases[0].owner_role) : null,
      rationale: onHold
        ? [
            blocking[0]?.why_it_matters ?? blocking[0]?.rationale,
            "A deterministic control placed this hold. Neither the ML model nor the AI can lift it.",
          ]
            .filter(Boolean)
            .join(" ")
        : null,
      isHoldReason: onHold,
    });
  }

  // Investigation: only if one actually ran (lookups or completion events were recorded).
  if ((byStage.get("investigation") ?? []).length > 0) {
    const lookups = (byStage.get("investigation") ?? []).filter(
      (e) => e.action === "investigation.lookup",
    ).length;
    recorded("investigation", {
      summary: `Read-only · ${lookups} lookup${lookups === 1 ? "" : "s"} recorded`,
      rationale:
        "The investigation reads evidence and proposes next steps. It cannot verify, approve or release.",
    });
  }

  // Verification: only if verification events were recorded.
  const verificationEvents = byStage.get("verification") ?? [];
  if (verificationEvents.length > 0) {
    const denied = verificationEvents.some((e) => e.result === "DENIED");
    recorded("verification", {
      summary: denied
        ? "A verification attempt was blocked"
        : (last(verificationEvents)?.label ?? "Recorded"),
      status: denied && onHold ? "blocked" : "completed",
    });
  }

  // Approval: from the approval chain on the current version.
  const chain = record.approval_chain;
  if (chain.length > 0 || (byStage.get("approval") ?? []).length > 0) {
    const approved = chain.filter((s) => s.status === "APPROVED").length;
    const rejected = chain.some((s) => s.status === "REJECTED");
    const next = chain.find((s) => s.status === "PENDING");
    const allDone = chain.length > 0 && approved === chain.length;
    recorded("approval", {
      summary: rejected
        ? "Rejected by an approver"
        : allDone
          ? `All ${chain.length} approval${chain.length === 1 ? "" : "s"} recorded`
          : `${approved} of ${chain.length} approved${next ? ` · waiting on ${next.assigned_actor_name ?? roleLabel(next.required_role)}` : ""}`,
      status: rejected ? "failed" : allDone ? "completed" : onHold ? "proposed" : "pending",
      basis:
        (byStage.get("approval") ?? []).length > 0 ? "recorded" : allDone ? "record" : "proposed",
      actor: next?.assigned_actor_name ?? null,
      rationale:
        "Approvals are made by authorized people under the approval rules. Approvers can never release their own invoice's payment.",
    });
  }

  // Payment: only if the backend returned a payment record.
  const pay = record.payment_summary;
  if (pay) {
    recorded("payment", {
      summary: `${pay.state.toLowerCase().replaceAll("_", " ")} · simulated, no real money moved`,
      status: pay.state === "FAILED" ? "failed" : pay.state === "SETTLED" ? "completed" : "pending",
    });
  }

  // Audit trail: always last; every recorded event is in it.
  recorded("audit", {
    summary: `${events.length} event${events.length === 1 ? "" : "s"} recorded`,
    basis: "recorded",
    rationale: "Every step above is persisted in the tamper-evident audit trail.",
  });

  // Order recorded stages by the canonical sequence.
  nodes.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const actual = nodes.filter((n) => n.basis !== "proposed" && n.stage !== "audit");
  const audit = nodes.find((n) => n.stage === "audit")!;
  const pendingApproval = nodes.find((n) => n.stage === "approval" && n.basis === "proposed");

  const edges: GraphEdgeModel[] = [];
  const holdIdx = actual.findIndex((n) => n.isHoldReason);
  actual.forEach((n, i) => {
    const next = actual[i + 1];
    if (next)
      edges.push({
        id: `${n.id}->${next.id}`,
        source: n.id,
        target: next.id,
        kind: "recorded",
        active: holdIdx === -1 || i < holdIdx,
      });
  });
  const tip = actual[actual.length - 1];
  if (tip)
    edges.push({
      id: `${tip.id}->audit`,
      source: tip.id,
      target: "audit",
      kind: "recorded",
      active: false,
    });

  // Proposed next steps from the backend Path to Pay, chained after the current node.
  const proposedSteps = flight?.proposed_next ?? [];
  const from = holdIdx >= 0 ? actual[holdIdx] : tip;
  let prev = from?.id ?? null;
  const proposedNodes: GraphNodeModel[] = proposedSteps.map((p, i) => ({
    id: `proposed:${p.id}`,
    stage: stageOfProposed(p.action),
    label: p.label.replace(/^Not yet happened — /, ""),
    summary: `Not yet done${p.actor_name ? ` · ${roleLabel(p.actor_name)}` : ""}`,
    status: "proposed",
    basis: "proposed",
    actor: null, // already in the summary; who acts is shown in the drawer
    at: null,
    events: [],
    findings: [],
    rationale: `${
      i === 0
        ? "This is the next step on the backend's Path to Pay."
        : "A later step on the Path to Pay."
    } It has not happened yet.${p.actor_name ? ` Who acts: ${roleLabel(p.actor_name)}.` : ""}`,
  }));
  for (const n of proposedNodes) {
    if (prev)
      edges.push({
        id: `${prev}->${n.id}`,
        source: prev,
        target: n.id,
        kind: "proposed",
        active: false,
      });
    prev = n.id;
  }
  // If the backend proposes nothing but approvals are still waiting, link the pending approval.
  if (!proposedNodes.length && pendingApproval && from && from.id !== pendingApproval.id) {
    edges.push({
      id: `${from.id}->${pendingApproval.id}`,
      source: from.id,
      target: pendingApproval.id,
      kind: "proposed",
      active: false,
    });
  }

  const all = [...nodes, ...proposedNodes];
  // Keep a proposed approval node only if it's linked.
  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const finalNodes = all.filter((n) => n.stage === "audit" || linked.has(n.id) || n === audit);
  const focus =
    finalNodes.find((n) => n.isHoldReason) ??
    finalNodes.find((n) => n.status === "pending") ??
    proposedNodes[0] ??
    null;
  return { nodes: finalNodes, edges, focusId: focus?.id ?? null };
}

/** Positions for a left-to-right layout: recorded path on row 0, proposed steps on row 1. */
export function layoutDecisionGraph(model: DecisionGraphModel, colWidth = 230, rowHeight = 170) {
  const pos = new Map<string, { x: number; y: number }>();
  const recorded = model.nodes.filter((n) => n.basis !== "proposed" || n.stage === "approval");
  const mainPath = recorded.filter((n) => !(n.basis === "proposed" && n.stage === "approval"));
  mainPath.forEach((n, i) => pos.set(n.id, { x: i * colWidth, y: 0 }));
  const proposed = model.nodes.filter((n) => !pos.has(n.id));
  // The proposed row starts at the left edge (keeps the canvas compact), but never to the right
  // of the step it branches from when there is room for every proposed step.
  const firstEdge = model.edges.find((e) => e.kind === "proposed");
  const branchX = firstEdge ? (pos.get(firstEdge.source)?.x ?? 0) : 0;
  const rowWidth = Math.max(mainPath.length, 1) * colWidth;
  const start = Math.max(0, Math.min(branchX, rowWidth - proposed.length * colWidth));
  proposed.forEach((n, i) => pos.set(n.id, { x: start + i * colWidth, y: rowHeight }));
  return pos;
}
