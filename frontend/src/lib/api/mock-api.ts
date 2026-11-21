/**
 * In-memory mock of the Sentinel backend. Prototype only — never a payment authority.
 */
import { findUser } from "@/lib/domain/roles";
import type { Invoice, NotificationItem } from "@/lib/domain/types";
import { SEED_INVOICES } from "@/lib/mock/fixtures";
import {
  amountCadMinor,
  buildHomeSummary,
  checksFor,
  eligibleReleaser,
  filterInvoices,
  scopeFor,
  toTask,
} from "@/lib/mock/rules";
import type { SentinelApi } from "./contract";

const PROCESSING_MS = 6000;
let store: Invoice[] = SEED_INVOICES.map((i) => ({ ...i }));
let uploadSeq = 423;

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** Uploaded files finish "processing" after a few seconds; values are never guessed. */
function advanceProcessing() {
  const now = Date.now();
  store = store.map((inv) =>
    inv.status === "processing" && inv.processingStartedAt && now - inv.processingStartedAt > PROCESSING_MS
      ? {
          ...inv,
          status: "needs_review",
          findings: [
            {
              code: "EXTRACTION_UNREADABLE",
              severity: "medium",
              blocking: true,
              title: "Invoice details need to be entered",
              whyItMatters:
                "Document reading runs on the Sentinel backend, which isn't connected in this prototype. Nothing is guessed.",
              whatHappensNext: "Open the document and enter the supplier, number and total.",
              evidenceIds: [inv.sourceRef],
            },
          ],
        }
      : inv,
  );
}

const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    title: "Payment paused",
    body: "Cascadia Cartage changed bank details by email. Verification needed.",
    time: "2026-11-18T14:23:00Z",
    invoiceId: "AP-00412",
    tone: "critical",
  },
  {
    id: "n2",
    title: "Unusual amount",
    body: "Lattice Ledger 557 is much higher than their usual invoice.",
    time: "2026-11-19T16:41:00Z",
    invoiceId: "AP-00415",
    tone: "warning",
  },
  {
    id: "n3",
    title: "Missing document",
    body: "Northbridge Fuel's email says an invoice is attached, but none arrived.",
    time: "2026-11-21T08:42:00Z",
    invoiceId: "AP-00422",
    tone: "warning",
  },
  {
    id: "n4",
    title: "Simulated settlement complete",
    body: "Voyageur Transport VT-20931 settled (simulated).",
    time: "2026-11-19T09:00:00Z",
    invoiceId: "AP-00388",
    tone: "success",
  },
];

export const mockApi: SentinelApi = {
  async getHome(actorId) {
    await wait();
    advanceProcessing();
    return buildHomeSummary(store, findUser(actorId));
  },
  async listInvoices(actorId, params) {
    await wait();
    advanceProcessing();
    const user = findUser(actorId);
    return filterInvoices(scopeFor(store, user), params).map((i) => toTask(i, user));
  },
  async getInvoice(actorId, invoiceId) {
    await wait();
    advanceProcessing();
    const user = findUser(actorId);
    const inv = scopeFor(store, user).find((i) => i.id === invoiceId);
    if (!inv) return null;
    return {
      ...toTask(inv, user),
      checks: checksFor(inv),
      eligibleReleaser: eligibleReleaser(inv)?.name ?? null,
      amountCadMinor: amountCadMinor(inv),
    };
  },
  async uploadInvoice(actorId, input) {
    await wait(400);
    const user = findUser(actorId);
    const id = `AP-00${uploadSeq++}`;
    const inv: Invoice = {
      id,
      number: null,
      kind: "invoice",
      supplierId: "PENDING",
      supplierName: input.fileName.replace(/\.[^.]+$/, ""),
      totalMinor: null,
      subtotalMinor: null,
      taxes: [],
      currency: "CAD",
      issueDate: null,
      dueDate: null,
      receivedAt: new Date().toISOString(),
      status: "processing",
      risk: "low",
      language: "en",
      scanned: /\.(png|jpe?g)$/i.test(input.fileName),
      channel: "upload",
      sourceRef: `UP-${id.slice(-3)}`,
      fileName: input.fileName,
      department: user.department,
      requesterId: user.id,
      lineItems: [],
      findings: [],
      approvalChain: [],
      processingStartedAt: Date.now(),
    };
    store = [inv, ...store];
    return toTask(inv, user);
  },
  async listNotifications() {
    await wait(60);
    return NOTIFICATIONS;
  },
};
