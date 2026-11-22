import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResolutionCase } from "@/components/sentinel/resolution-case";
import type { CaseDetail } from "@/lib/api/schema";
import { plainSentence } from "@/lib/plain-language";

vi.mock("@/lib/session", () => ({
  useSession: () => ({
    user: { id: "U004", role: "ap_clerk" },
    users: [{ id: "U005", name: "Sam Patel", initials: "SP" }],
    permissions: [],
  }),
}));

const bankCase = {
  id: "CASE-1",
  invoice_id: "IN-1",
  invoice_version: 1,
  case_type: "BANK_CHANGE_UNVERIFIED",
  title: "Bank account changed and not yet verified",
  state: "AWAITING_VERIFICATION",
  severity: "critical",
  owner_role: "ap_clerk",
  owner_id: null,
  finding_ids: ["F1"],
  bank_change_id: "BC-009",
  closure_outcome: null,
  row_version: 1,
  allowed_actions: [],
  created_at: "2026-11-22T05:59:00",
  updated_at: "2026-11-22T05:59:00",
  path_to_pay_steps: [
    { key: "hold", label: "Payment paused (hold placed)", status: "DONE", actor_role: "system" },
    { key: "callback", label: "Call the supplier", status: "CURRENT", actor_role: "ap_clerk" },
    { key: "route", label: "Finance authorizes", status: "PENDING", actor_role: "finance_manager" },
  ],
  findings: [
    {
      id: "F1",
      title: "Bank account changed and not yet verified",
      rationale: "Bank change BC-009 via email_request (state PENDING_INDEPENDENT_VERIFICATION).",
      why_it_matters: "Changed bank details are a common fraud route.",
      blocking: true,
    },
  ],
  actions: [],
  evidence_refs: [],
  bank_change: {
    id: "BC-009",
    requested_by_user_id: "U004",
    old_account_masked: "****7504",
    new_account_masked: "****9679",
    trusted_contacts: [{ id: "C1", value: "ar@cascadia.example" }],
    allowed_actions: [],
    verification_outcome: null,
  },
  wizard: { current_step: "verify_supplier", hold_active: true, steps: [], failure_states: [] },
  invoice: { lifecycle_state: "ON_HOLD", allowed_actions: [], version: 1 },
} as unknown as CaseDetail;

function renderCase() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["case", "U004", "CASE-1"], bankCase);
  render(
    <QueryClientProvider client={client}>
      <ResolutionCase id="CASE-1" />
    </QueryClientProvider>,
  );
}

describe("case view", () => {
  it("explains the hold as a message in plain words, not internal codes", () => {
    renderCase();
    const thread = screen.getByRole("region", { name: "Case conversation" });
    expect(within(thread).getByText(/I paused payment on this invoice/)).toBeTruthy();
    expect(thread.textContent).not.toMatch(/PENDING_INDEPENDENT_VERIFICATION|email_request/);
    expect(
      within(thread).getByRole("button", { name: "Ask Sentinel AI to explain this case" }),
    ).toBeTruthy();
  });

  it("lists the backend's Path to Pay steps with owner and marks only the current one", () => {
    renderCase();
    const steps = screen.getAllByRole("listitem").filter((li) => li.closest("ol[class*='mt-3']"));
    expect(steps.length).toBeGreaterThan(0);
    expect(screen.getByText("1/3 done")).toBeTruthy();
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Call the supplier");
    expect(current?.textContent).toContain("AP clerk · Now");
    expect(screen.getByText("Finance manager")).toBeTruthy();
  });

  it("says why this person can't act instead of showing a form they can't use", () => {
    renderCase();
    expect(
      screen.getByText(/You entered this bank change, so someone else must verify it/),
    ).toBeTruthy();
    expect(screen.queryByText("Record the callback result")).toBeNull();
  });
});

describe("plain sentences", () => {
  it("rewrites state and channel codes but keeps record IDs", () => {
    const out = plainSentence(
      "Bank change BC-009 via email_request (state PENDING_INDEPENDENT_VERIFICATION) on IN-EM-019-1.",
    );
    expect(out).toContain("BC-009");
    expect(out).toContain("IN-EM-019-1");
    expect(out).toContain("email request");
    expect(out).toContain("(waiting for supplier verification)");
  });
});
