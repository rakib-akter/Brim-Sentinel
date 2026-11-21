import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ApprovalDecision } from "@/components/sentinel/invoice-actions";
import { PaymentWorkflow } from "@/components/sentinel/payment-workflow";
import { FlightRecorder } from "@/components/sentinel/flight-recorder";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/http-api";
import type { InvoiceDetail } from "@/lib/api/schema";

vi.mock("@/lib/session", () => ({ useSession: () => ({ user: { id: "U007" } }) }));

function renderWorkflow(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return invalidate;
}

const invoice = {
  id: "IN-TEST",
  version: 3,
  allowed_actions: ["approve", "reject"],
  approval_chain: [{ step_key: "dept_manager", status: "PENDING", assigned_actor_id: "U007" }],
  payment_summary: null,
} as InvoiceDetail;

afterEach(() => vi.restoreAllMocks());

describe("Invoice workflow controls", () => {
  it("requires the backend action and a pending step assigned to the current actor", () => {
    const { rerender } = render(<ApprovalDecision invoice={{ ...invoice, allowed_actions: [] }} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <ApprovalDecision
        invoice={{
          ...invoice,
          approval_chain: invoice.approval_chain.map((step) => ({
            ...step,
            assigned_actor_id: "U009",
          })),
        }}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends the current version and assigned step and refreshes after a conflict", async () => {
    const decision = vi
      .spyOn(api, "decide")
      .mockRejectedValue(
        new ApiError(
          409,
          "INVOICE_VERSION_CONFLICT",
          "This invoice changed. Refresh before continuing.",
        ),
      );
    const invalidate = renderWorkflow(<ApprovalDecision invoice={invoice} />);
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "APPROVED" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This invoice changed");
    expect(decision).toHaveBeenCalledWith("U007", "IN-TEST", "dept_manager", {
      expected_version: 3,
      decision: "APPROVED",
      reason: null,
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("does not submit a rejection without a reason", async () => {
    const decision = vi.spyOn(api, "decide");
    renderWorkflow(<ApprovalDecision invoice={invoice} />);
    fireEvent.change(screen.getByLabelText("Decision"), { target: { value: "REJECTED" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval decision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a rejection reason");
    expect(decision).not.toHaveBeenCalled();
  });

  it("keeps a simulated payment read-only when release is not allowed", () => {
    renderWorkflow(
      <PaymentWorkflow
        invoice={{
          ...invoice,
          allowed_actions: [],
          payment_summary: {
            id: "P-TEST",
            state: "SCHEDULED",
            simulation: true,
            amount_minor: 12345,
            currency: "CAD",
            method: "EFT",
          } as NonNullable<InvoiceDetail["payment_summary"]>,
        }}
      />,
    );
    expect(screen.getByText("Waiting for an eligible independent releaser.")).toBeInTheDocument();
    expect(screen.getAllByText("Simulated")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /release/i })).toBeNull();
  });

  it("reuses the release idempotency key after an ambiguous transport error", async () => {
    const release = vi.spyOn(api, "release").mockRejectedValue(new Error("Connection closed"));
    renderWorkflow(
      <PaymentWorkflow
        invoice={{
          ...invoice,
          allowed_actions: ["release_payment"],
          payment_summary: {
            id: "P-TEST",
            state: "SCHEDULED",
            simulation: true,
            amount_minor: 12345,
            currency: "CAD",
            method: "EFT",
          } as NonNullable<InvoiceDetail["payment_summary"]>,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Release simulated payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection closed");
    fireEvent.click(screen.getByRole("button", { name: "Release simulated payment" }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(2));
    expect(release.mock.calls[0]).toEqual(release.mock.calls[1]);
  });

  it("renders persisted Flight Recorder events separately from proposed steps", async () => {
    vi.spyOn(api, "flight").mockResolvedValue({
      invoice_id: "IN-TEST",
      as_of: "2026-11-03T12:00:00Z",
      events: [
        {
          id: "1",
          kind: "persisted",
          occurred_at: "2026-11-03T12:00:00Z",
          actor_id: "U004",
          actor_name: null,
          action: "case.opened",
          label: "Case opened",
          before_state: null,
          after_state: "OPEN",
          result: "SUCCESS",
          policy_ids: [],
          evidence_refs: [],
        },
      ],
      proposed_next: [
        {
          id: "2",
          kind: "proposed",
          occurred_at: null,
          actor_id: null,
          actor_name: null,
          action: "verify",
          label: "Verify supplier",
          before_state: null,
          after_state: null,
          result: null,
          policy_ids: [],
          evidence_refs: [],
        },
      ],
    });
    renderWorkflow(<FlightRecorder invoiceId="IN-TEST" />);
    fireEvent.click(screen.getByRole("button", { name: "Financial Flight Recorder" }));
    const event = await screen.findByText("Case opened");
    const proposal = screen.getByText("Verify supplier");
    expect(event.closest("ol")).not.toBeNull();
    expect(proposal.closest("ol")).toBeNull();
    expect(proposal.closest("section")).toHaveTextContent("Proposed next steps");
  });
});
