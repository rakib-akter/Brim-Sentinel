import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const invoiceId = "IN-EM-019-1";
const invoicePath = `/invoices/${invoiceId}`;

async function switchActor(page: Page, current: string, next: string) {
  await page.getByRole("button", { name: new RegExp(current) }).click();
  await page.getByRole("menuitem", { name: new RegExp(next) }).click();
  await expect(page.getByRole("button", { name: new RegExp(next) })).toBeVisible();
}

test("Detect → Resolve → Settle → Explain using seeded FastAPI records", async ({ page }) => {
  await page.goto("/audit");
  await expect(page.getByRole("alert")).toContainText("access requires an authorized demo role");
  await page.goto("/invoices");
  await page.getByRole("textbox", { name: "Search by supplier or invoice number" }).fill("1625");
  await page
    .getByRole("row", { name: /Cascadia.*1625/ })
    .getByRole("link", { name: "Cascadia Cartage Ltd.", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(invoicePath));
  await expect(page.getByText("Payment paused", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Schedule simulated payment" })).toHaveCount(0);
  const resolution = page.locator("#resolution");
  const contact = resolution.getByLabel("Trusted contact");
  await contact.selectOption({ index: 1 });
  await resolution.getByLabel("Callback time (local time)").fill("2026-11-03T10:15");
  await resolution.getByLabel("Callback outcome").selectOption("CONFIRMED");
  await resolution.getByLabel("Call log reference").fill("x");
  await resolution
    .getByLabel("Verification notes")
    .fill("Synthetic fixture callback to supplier contact on file.");
  await resolution.getByRole("button", { name: "Record supplier verification" }).click();
  await expect(resolution.getByRole("alert")).toContainText("evidence reference");
  await expect(resolution.getByText("Payment paused", { exact: true }).first()).toBeVisible();
  await resolution.getByLabel("Call log reference").fill("BROWSER-SYNTHETIC-CALL-019");
  await resolution.getByRole("button", { name: "Record supplier verification" }).click();
  await expect(resolution.getByText(/BROWSER-SYNTHETIC-CALL-019/)).toBeVisible();
  await expect(
    resolution.getByRole("button", { name: "Authorize verified EFT change" }),
  ).toHaveCount(0);

  await switchActor(page, "Jordan Okafor", "Elise Tremblay");
  await resolution
    .getByLabel("Finance authorization rationale")
    .fill("Reviewed the synthetic callback evidence.");
  await resolution.getByRole("button", { name: "Authorize verified EFT change" }).click();
  await expect(resolution.getByText("Bank verification complete")).toBeVisible();
  await resolution.getByRole("button", { name: "Request invoice approvals" }).click();
  await expect(
    resolution.getByRole("status").filter({ hasText: "Invoice approval request recorded." }),
  ).toBeVisible();

  await switchActor(page, "Elise Tremblay", "Dev Malhotra");
  await page.goto("/approvals");
  await page
    .getByRole("row", { name: /Cascadia.*1625/ })
    .getByRole("link", { name: "Cascadia Cartage Ltd.", exact: true })
    .click();
  await page.getByLabel("Decision", { exact: true }).selectOption("APPROVED");
  await page.getByRole("button", { name: "Record approval decision" }).click();
  await expect(page.getByRole("button", { name: "Record approval decision" })).toHaveCount(0);

  await switchActor(page, "Dev Malhotra", "Jordan Okafor");
  await page.getByRole("button", { name: "Schedule simulated payment" }).click();
  await expect(page.locator("#payment")).toContainText(
    "Waiting for an eligible independent releaser.",
  );
  await expect(page.getByRole("button", { name: "Release simulated payment" })).toHaveCount(0);
  await switchActor(page, "Jordan Okafor", "Elise Tremblay");
  await page.getByRole("button", { name: "Release simulated payment" }).click();
  await page.getByLabel("Outcome", { exact: true }).selectOption("SETTLED");
  await page.getByRole("button", { name: "Record simulated settlement" }).click();
  await expect(page.locator("#payment").getByText(/settled · EFT/i)).toBeVisible();
  await expect(page.locator("#payment")).toContainText("Released by U003");

  await switchActor(page, "Elise Tremblay", "Hannah Lindqvist");
  await page.getByRole("button", { name: "See payment journey" }).click();
  await expect(page.getByText("Simulated settlement recorded", { exact: true })).toBeVisible();
  await expect(page.getByText("Simulated payment released", { exact: true })).toBeVisible();
  await page.goto("/audit");
  await page.getByLabel("Invoice ID", { exact: true }).fill(invoiceId);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText(/payment · simulated settled/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download filtered CSV" }).click();
  expect((await download).suggestedFilename()).toBe("brim_audit.csv");
});

test("intake creates one draft and reports an already received file", async ({ page }) => {
  const file = fileURLToPath(
    new URL("../../../data/brim_ap_dataset/incoming_invoices/Invoice 000809.pdf", import.meta.url),
  );
  await page.goto("/invoices");
  for (const label of ["1 draft created", "Invoices already in the inbox"]) {
    await page.getByRole("button", { name: "Upload invoice", exact: true }).click();
    await page.getByLabel("Choose invoice files").setInputFiles(file);
    await page.getByRole("button", { name: "Upload 1", exact: true }).click();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});
