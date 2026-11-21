// Run after bun run build, with BRIM_TEST_PYTHON pointing to the backend Python environment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpApi, ApiError } from "../src/lib/api/http-api.ts";

const python = process.env.BRIM_TEST_PYTHON ?? "python3";
const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "brim-frontend-integration-"));
const env = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  DEMO_MODE: "true",
  AI_ENABLED: "false",
  DATABASE_URL: `sqlite:///${join(dir, "test.db")}`,
  BRIM_UPLOAD_DIR: join(dir, "uploads"),
  BRIM_DATA_DIR: fileURLToPath(new URL("../../data/brim_ap_dataset/", import.meta.url)),
};

function runPython(args, input) {
  const result = spawnSync(python, args, {
    cwd: backend,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}

// Use FastAPI's in-process HTTP transport so this test also works without binding network ports.
const bridge = `
import base64, json, sys
from fastapi.testclient import TestClient
from app.main import app

r = json.load(sys.stdin)
response = TestClient(app).request(r["method"], r["path"], headers=r["headers"], content=base64.b64decode(r["body"]))
print(json.dumps({"status": response.status_code, "type": response.headers.get("content-type"), "body": base64.b64encode(response.content).decode()}))
`;

const originalFetch = globalThis.fetch;
try {
  const seed = JSON.parse(runPython(["-m", "scripts.seed"]));
  assert.equal(seed.counts.intake.drafts_created, 56);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.match(url.pathname, /^\/api\/v1\//);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const body = Buffer.from(await request.arrayBuffer()).toString("base64");
    const result = JSON.parse(
      runPython(
        ["-c", bridge],
        JSON.stringify({
          method: request.method,
          path: url.pathname + url.search,
          headers: Object.fromEntries(request.headers),
          body,
        }),
      ),
    );
    return new Response(Buffer.from(result.body, "base64"), {
      status: result.status,
      headers: { "Content-Type": result.type ?? "application/octet-stream" },
    });
  };

  const api = createHttpApi("http://localhost:8000");
  const { default: app } = await import("../.output/server/index.mjs");
  async function html(path, actor, match) {
    const response = await app.fetch(
      new Request(`http://localhost:8080${path}`, {
        headers: { Cookie: `sentinel-demo-identity=${actor}` },
      }),
      {},
      { waitUntil() {} },
    );
    const markup = await response.text();
    assert.equal(response.status, 200, markup.slice(0, 500));
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(match.test(markup), `Expected ${match} in the rendered HTML for ${path} as ${actor}`);
    return markup;
  }

  const clerk = "U004";
  const auditor = "U006";
  const requester = "U013";
  const approver = "U007";
  const finance = "U003";
  const invoiceId = "IN-EM-019-1";
  const first = await api.invoice(clerk, invoiceId);
  const summary = first.resolution_cases.find(
    (item) => item.case_type === "BANK_CHANGE_UNVERIFIED",
  );
  assert.ok(summary);
  const caseId = summary.id;

  assert.match(await html("/invoices", clerk, /Cascadia/), /Jordan Okafor/);
  const scoped = await api.invoices(requester, {});
  assert.ok(scoped.length > 0 && scoped.every((row) => row.requester_id === requester));
  const hidden = (await api.invoices(clerk, {})).find((row) => row.requester_id !== requester);
  assert.ok(hidden);
  const denied = await html(
    `/invoices/${hidden.id}`,
    requester,
    /This invoice isn(?:&#x27;|&#39;|')t available to you/,
  );
  assert.doesNotMatch(denied, /Download original/);
  const status = (expected) => (error) => error instanceof ApiError && error.status === expected;
  await assert.rejects(
    api.document(requester, hidden.id),
    (error) => status(403)(error) || status(404)(error),
  );
  const original = await api.document(clerk, invoiceId);
  assert.match((await original.text()).slice(0, 5), /^%PDF-/);
  await html("/audit", clerk, /access requires an authorized demo role/);
  await html("/audit", auditor, /Verify hash chain/);

  const held = await api.case(clerk, caseId);
  assert.equal(held.wizard.current_step, "verify_supplier");
  assert.equal(
    held.wizard.route_options.find((option) => option.method === "CARD").available,
    false,
  );
  await html(`/investigations?caseId=${caseId}`, clerk, /Call log reference/);
  const evidence = {
    expected_row_version: held.bank_change.row_version,
    trusted_contact_id: held.bank_change.trusted_contacts[0].id,
    method: "phone_callback_to_contact_on_file",
    occurred_at: "2026-11-03T10:15:00Z",
    outcome: "CONFIRMED",
    notes: "Synthetic test fixture callback to supplier contact on file.",
    evidence_ref: "TEST-SYNTHETIC-CALL-019",
  };
  await assert.rejects(api.verify(clerk, caseId, { ...evidence, evidence_ref: "" }), status(422));
  await assert.rejects(api.verify("U005", caseId, evidence), status(403));
  const verified = await api.verify(clerk, caseId, evidence);
  assert.equal(verified.bank_change.state, "PENDING_ROUTE_AUTHORIZATION");
  assert.equal(verified.wizard.hold_active, true);
  await assert.rejects(
    api.authorizeRoute(clerk, caseId, {
      expected_row_version: verified.bank_change.row_version,
      notes: "Attempt made by fixture verifier.",
    }),
    status(403),
  );
  const authorized = await api.authorizeRoute(finance, caseId, {
    expected_row_version: verified.bank_change.row_version,
    notes: "Reviewed the synthetic test callback record.",
  });
  assert.equal(authorized.bank_change.state, "CLOSED");
  const current = authorized.invoice;
  await html(`/investigations?caseId=${caseId}`, clerk, /Request invoice approvals/);
  const requested = await api.requestAuthorization(clerk, caseId, {
    expected_invoice_version: current.version,
  });
  assert.equal(requested.invoice.lifecycle_state, "PENDING_APPROVAL");

  await html(`/invoices/${invoiceId}`, approver, /Record approval decision/);
  const decision = { expected_version: current.version, decision: "APPROVED" };
  await assert.rejects(api.decide(auditor, invoiceId, "dept_manager", decision), status(403));
  await assert.rejects(
    api.decide(approver, invoiceId, "dept_manager", { ...decision, expected_version: 0 }),
    status(409),
  );
  const approved = await api.decide(approver, invoiceId, "dept_manager", decision);
  assert.equal(approved.lifecycle_state, "APPROVED");
  const payment = await api.prepare(clerk, {
    invoice_id: invoiceId,
    expected_version: approved.version,
  });
  assert.equal(payment.simulation, true);
  assert.equal(payment.state, "SCHEDULED");
  await html("/payments", finance, /Simulated payment records/);
  await html(`/invoices/${invoiceId}`, finance, /Release simulated payment/);
  const release = { expected_invoice_version: approved.version };
  const key = "frontend-integration-release";
  await assert.rejects(api.release(approver, payment.id, release, key), status(403));
  assert.equal((await api.release(finance, payment.id, release, key)).state, "RELEASED");
  assert.equal((await api.release(finance, payment.id, release, key)).idempotent_replay, true);
  assert.equal((await api.settle(finance, payment.id, { outcome: "SETTLED" })).state, "SETTLED");

  const flight = await api.flight(auditor, invoiceId);
  for (const action of [
    "case.resolved",
    "case.authorization_requested",
    "payment.released",
    "payment.simulated_settled",
  ]) {
    assert.ok(
      flight.events.some((event) => event.kind === "persisted" && event.action === action),
      action,
    );
  }
  assert.ok(flight.events.some((event) => event.result === "DENIED"));
  const csv = await api.exportAudit(auditor, new URLSearchParams({ invoice_id: invoiceId }));
  assert.match(await csv.text(), /payment\.simulated_settled/);
  assert.equal((await api.verifyAudit(auditor)).valid, true);
  const inputDir = join(env.BRIM_DATA_DIR, "incoming_invoices");
  const name = readdirSync(inputDir).find((file) => file.endsWith(".pdf"));
  assert.ok(name);
  const upload = new File([readFileSync(join(inputDir, name))], name, { type: "application/pdf" });
  const created = await api.upload(clerk, upload);
  assert.equal(created.created, true);
  const repeated = await api.upload(clerk, upload);
  assert.equal(repeated.invoice.id, created.invoice.id);
  assert.equal(repeated.created, false);
  console.log(
    "FastAPI and SSR integration passed: scoped access, bank resolution, approval, simulated settlement and audit.",
  );
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dir, { recursive: true, force: true });
}
