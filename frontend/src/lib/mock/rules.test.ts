import { describe, expect, it } from "vitest";
import { findUser } from "@/lib/domain/roles";
import type { Invoice } from "@/lib/domain/types";
import { SEED_INVOICES } from "./fixtures";
import {
  buildHomeSummary,
  checksFor,
  eligibleReleaser,
  filterInvoices,
  primaryActionFor,
} from "./rules";

const byId = (id: string): Invoice => {
  const inv = SEED_INVOICES.find((i) => i.id === id);
  if (!inv) throw new Error(`missing fixture ${id}`);
  return inv;
};
const clerk = findUser("U007");
const financeManager = findUser("U003");
const auditor = findUser("U030");
const requester = findUser("U020");

describe("next action", () => {
  it("unverified bank change asks the clerk to review bank details", () => {
    expect(primaryActionFor(byId("AP-00412"), clerk).label).toBe("Review bank details");
  });

  it("only the person at the current approval step gets Approve", () => {
    const legal = byId("AP-00405"); // pending at Finance Manager
    expect(primaryActionFor(legal, financeManager).kind).toBe("approve");
    expect(primaryActionFor(legal, clerk).kind).toBe("view_approval");
  });

  it("auditors only ever get a read-only action", () => {
    for (const inv of SEED_INVOICES)
      expect(primaryActionFor(inv, auditor).kind).toBe("view_record");
  });

  it("requesters cannot resolve holds", () => {
    expect(primaryActionFor(byId("AP-00412"), requester).kind).toBe("view_record");
  });
});

describe("home summary", () => {
  it("AP clerk has no approvals; Finance Manager sees theirs", () => {
    expect(buildHomeSummary(SEED_INVOICES, clerk).readyForApproval).toHaveLength(0);
    const ids = buildHomeSummary(SEED_INVOICES, financeManager).readyForApproval.map(
      (t) => t.invoice.id,
    );
    expect(ids).toEqual(expect.arrayContaining(["AP-00405", "AP-00408", "AP-00410"]));
  });

  it("auditor sees no attention tasks", () => {
    expect(buildHomeSummary(SEED_INVOICES, auditor).needsAttention).toHaveLength(0);
  });

  it("requester only sees their own submissions", () => {
    const s = buildHomeSummary(SEED_INVOICES, requester);
    for (const t of [...s.needsAttention, ...s.upcomingPayments])
      expect(t.invoice.requesterId).toBe("U020");
  });

  it("blocking holds are listed before advisory reviews", () => {
    const first = buildHomeSummary(SEED_INVOICES, clerk).needsAttention[0];
    expect(first?.invoice.findings.some((f) => f.blocking)).toBe(true);
  });
});

describe("eligible releaser (P09–P11)", () => {
  it("Finance Manager releases up to CAD 100,000 when not an approver", () => {
    expect(eligibleReleaser(byId("AP-00403"))?.id).toBe("U003");
  });
  it("falls to the Controller when the Finance Manager approved", () => {
    expect(eligibleReleaser(byId("AP-00399"))?.id).toBe("U001");
  });
  it("nobody is eligible above CAD 250,000 when both controller_admins approve", () => {
    expect(eligibleReleaser(byId("AP-00419"))).toBeNull();
  });
});

describe("checks", () => {
  it("unreadable totals are UNKNOWN, never PASS", () => {
    const math = checksFor(byId("AP-00414")).find((c) => c.name === "Invoice math");
    expect(math?.result).toBe("UNKNOWN");
  });
});

describe("inbox filter", () => {
  it("search matches supplier name case-insensitively", () => {
    expect(
      filterInvoices(SEED_INVOICES, { q: "cascadia" })
        .map((i) => i.id)
        .sort(),
    ).toEqual(["AP-00409", "AP-00412"]);
  });
  it("credit notes are grouped under Done, never Payments", () => {
    expect(
      filterInvoices(SEED_INVOICES, { status: "payment" }).some((i) => i.kind === "credit_note"),
    ).toBe(false);
  });
});
