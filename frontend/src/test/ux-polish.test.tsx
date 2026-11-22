import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CodingPanel } from "@/components/sentinel/ml-coding";
import { SentinelAnalysis } from "@/components/sentinel/invoice-workspace";
import { shortActionLabel } from "@/lib/api/presentation";
import type { InvoiceDetail, LineOut } from "@/lib/api/schema";
import { sortCases } from "@/lib/cases";
import type { Finding } from "@/lib/domain/types";

vi.mock("@/lib/session", () => ({ useSession: () => ({ user: { id: "U004" } }) }));

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const line = (over: Partial<LineOut>): LineOut => ({
  line_no: 1,
  description: "LTL shipment Ottawa-Toronto",
  quantity: "1",
  unit_price_minor: 88657,
  amount_minor: 88657,
  line_type: null,
  gl_account: "5010",
  gl_name: "Freight & Carrier Costs",
  department_id: null,
  coding_confidence: "0.98",
  coding_status: "SUGGESTED",
  coding_method: "ml_model",
  alternatives: [{ gl_account: "6610", gl_name: "Rent & Operating Costs", weight: 0.01 }],
  similar_lines: [],
  ...over,
});

const record = (over: Partial<InvoiceDetail>) =>
  ({
    id: "IN-1",
    version: 1,
    currency: "CAD",
    provenance: "pdf_text",
    uncertain_fields: [],
    line_items: [],
    validation_findings: [],
    resolution_cases: [],
    allowed_actions: [],
    ...over,
  }) as unknown as InvoiceDetail;

const f = (over: Partial<Finding>): Finding => ({
  id: "F1",
  code: "BANK_CHANGE_UNVERIFIED",
  severity: "high",
  blocking: true,
  title: "Bank account changed and not yet verified",
  whyItMatters: "Changed bank details are the most common way payments are stolen.",
  whatHappensNext: "Call the supplier on a contact already on file.",
  evidenceIds: [],
  ...over,
});

describe("short case actions", () => {
  it("replaces the long 'Resolve: <issue>' label with one verb and keeps other labels", () => {
    expect(shortActionLabel("resolve_issue", "Resolve: Supplier is not in the vendor master")).toBe(
      "Review case",
    );
    expect(shortActionLabel("review_bank_details", "Review bank details")).toBe(
      "Review bank details",
    );
  });
});

describe("investigations ordering", () => {
  it("puts the most severe case first, oldest first within a band", () => {
    const sorted = sortCases([
      { id: "low", severity: "low", created_at: "2026-11-01" },
      { id: "high-new", severity: "high", created_at: "2026-11-20" },
      { id: "critical", severity: "critical", created_at: "2026-11-21" },
      { id: "high-old", severity: "high", created_at: "2026-11-02" },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["critical", "high-old", "high-new", "low"]);
  });
});

describe("Sentinel analysis summary", () => {
  it("counts issues, separates blocking from advisory and does not repeat each explanation", () => {
    render(
      <SentinelAnalysis
        record={record({})}
        findings={[
          f({ id: "A", blocking: false, severity: "medium", title: "Price above usual" }),
          f({}),
        ]}
        plainStatus="Payment paused"
        actionLabel="Review bank details"
        actionTarget="resolution"
      />,
    );
    expect(screen.getByRole("heading", { name: "Sentinel found 2 issues" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Issues found" });
    const items = within(list).getAllByRole("button");
    // Blocking issue is ranked first.
    expect(items[0]?.textContent).toContain("Bank account changed");
    expect(items[0]?.textContent).toContain("Blocks payment");
    expect(items[1]?.textContent).toContain("Advisory");
    // The full "why it matters" lives once, in the finding card, not in the summary.
    expect(screen.queryByText(/most common way payments are stolen/)).toBeNull();
    expect(screen.getByRole("link", { name: /Review bank details/ })).toBeTruthy();
  });

  it("says plainly when nothing blocks payment", () => {
    render(
      <SentinelAnalysis
        record={record({})}
        findings={[]}
        plainStatus="Waiting for approval"
        actionLabel="View approval progress"
        actionTarget={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeTruthy();
    expect(screen.getByText("Every blocking check passed.")).toBeTruthy();
  });
});

describe("ML coding rows", () => {
  it("keeps confident lines compact and opens low-confidence lines for a person", () => {
    wrap(
      <CodingPanel
        record={record({
          allowed_actions: ["coding_decision"],
          line_items: [
            line({}),
            line({
              line_no: 2,
              description: "Mystery service",
              coding_confidence: "0.41",
              coding_status: "NEEDS_REVIEW",
            }),
          ],
        })}
      />,
    );
    // The low-confidence line explains itself without a click.
    expect(screen.getByText(/Low confidence: a person must choose/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept 5010" })).toBeTruthy();
    // The confident line shows a quiet Accept and hides alternatives until asked.
    expect(screen.getAllByText("Next most likely")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Show alternatives and why for line 1/ }));
    expect(screen.getAllByText("Next most likely")).toHaveLength(2);
  });

  it("offers no coding actions when the backend does not allow them", () => {
    wrap(<CodingPanel record={record({ allowed_actions: [], line_items: [line({})] })} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
