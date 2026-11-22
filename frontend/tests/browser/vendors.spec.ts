import { expect, test } from "@playwright/test";

test("vendor search and onboarding lead to masked bank changes", async ({ page }) => {
  await page.goto("/vendors");
  await page.getByLabel("Supplier name or ID").fill("V004");
  await page.getByRole("button", { name: "Search vendors" }).click();
  await page.getByRole("link", { name: /Cascadia/ }).click();
  await expect(page.getByRole("heading", { name: /Cascadia/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bank-change history" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open verification wizard/ }).first()).toBeVisible();
  await page.getByLabel("Include historical invoices").check();
  await expect(page.getByRole("table", { name: "Related invoices" })).toContainText("AP-00173");
  await page.getByRole("link", { name: "Back to vendor directory" }).click();

  await page.getByText("Request vendor onboarding", { exact: true }).click();
  await page.getByLabel("Legal name").fill("Browser Test Supply Co");
  await page.getByLabel("Contact email (optional)").fill("accounts@example.test");
  await page.getByRole("button", { name: "Submit onboarding request" }).click();
  await expect(page.getByRole("heading", { name: "Browser Test Supply Co" })).toBeVisible();
  await expect(page.getByText(/pending review/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate vendor" })).toHaveCount(0);

  await page.getByText("Request a bank change", { exact: true }).click();
  await page.getByLabel("Institution number").fill("001");
  await page.getByLabel("Transit number").fill("00012");
  await page.getByLabel("Account number").fill("123456789");
  await page.getByLabel("Request channel").selectOption("email_request");
  await page.getByRole("button", { name: "Submit bank-change request" }).click();
  await expect(page.getByRole("status")).toContainText("Bank-change request recorded.");
  await expect(page.getByText("No prior account → ****6789")).toBeVisible();
  await expect(page.getByLabel("Account number")).toHaveValue("");
  await expect(page.getByText(/No trusted contact predates this request/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record supplier verification" })).toHaveCount(0);

  await page.getByRole("button", { name: /Jordan Okafor/ }).click();
  await page.getByRole("menuitem", { name: /Elise Tremblay/ }).click();
  await expect(page.getByRole("button", { name: /Elise Tremblay/ })).toBeVisible();
  await page
    .getByLabel("Identity checks performed")
    .fill("Reviewed the synthetic supplier identity.");
  await page.getByRole("button", { name: "Activate vendor" }).click();
  await expect(page.getByText(/VN-\d+ · active/i)).toBeVisible();
});

test("directory shows loading, empty, retryable failure and permission denial", async ({
  page,
}) => {
  let respond: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    respond = resolve;
  });
  let status = 200;
  await page.route("**/api/v1/vendors?*", async (route) => {
    await pending;
    await route.fulfill({
      status,
      json: status === 200 ? [] : { error: { message: "Supplier service unavailable." } },
    });
  });
  await page.goto("/vendors");
  await expect(page.getByRole("status")).toHaveText("Loading vendors…");
  respond();
  await expect(page.getByText("No vendors found")).toBeVisible();
  status = 503;
  await page.getByLabel("Supplier name or ID").fill("Unavailable");
  await page.getByRole("button", { name: "Search vendors" }).click();
  await expect(page.getByRole("alert")).toHaveText("Supplier service unavailable.");
  status = 403;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Your demo role does not have access to this view.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});
