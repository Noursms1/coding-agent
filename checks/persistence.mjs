// Repositories, notes and sessions survive a restart.
import {
  startRuntime,
  expect,
} from "/home/user/oss-new/control/runtime/index.mjs";
import { withFakeGateway } from "./fake-gateway.mjs";

const T = { timeout: 30000 };
const runtime = await startRuntime(withFakeGateway());
try {
  const admin = await (await runtime.context("owner")).newPage();
  await admin.goto("/repositories");
  await admin.getByRole("switch", { name: "Enable acme/storefront" }).click();
  await expect(
    admin.getByRole("switch", { name: "Enable acme/storefront" }),
  ).toBeChecked(T);

  const page = await (await runtime.context("member")).newPage();
  await page.goto("/knowledge");
  await page.getByTestId("new-note").click();
  await page.getByLabel("Title").fill("Storefront deploys");
  await page.getByLabel("When to use").fill("When a change touches checkout");
  await page
    .getByLabel("Note", { exact: true })
    .fill("Checkout changes ship behind a flag.");
  await page.getByTestId("save-note").click();
  await expect(
    page.getByTestId("note-row").filter({ hasText: "Storefront deploys" }),
  ).toBeVisible(T);

  await page.goto("/sessions/new");
  await page.getByTestId("repo-select").click();
  await page.getByRole("option", { name: "acme/storefront" }).click();
  await page.getByTestId("mode-ask").click();
  await page.getByTestId("task-input").fill("Where are discounts applied?");
  await Promise.all([
    page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/),
    page.getByTestId("start-session").click(),
  ]);
  const id = page.url().split("/").pop();
  await expect(page.getByTestId("session-status")).toHaveText("Ready", T);

  await runtime.restart();

  const after = await (await runtime.context("member")).newPage();
  await after.goto("/");
  await expect(
    after
      .getByTestId("session-row")
      .filter({ hasText: "Where are discounts applied?" }),
  ).toContainText("Ready", T);
  await after.goto(`/sessions/${id}`);
  await expect(after.getByTestId("chat")).toContainText(
    "Discounts are applied in total()",
    T,
  );
  await expect(after.getByTestId("timeline")).toContainText(
    "Storefront deploys",
  );
  await after.goto("/knowledge");
  await expect(
    after.getByTestId("note-row").filter({ hasText: "Storefront deploys" }),
  ).toContainText("Checkout changes ship behind a flag.", T);
  const adminAfter = await (await runtime.context("owner")).newPage();
  await adminAfter.goto("/repositories");
  await expect(
    adminAfter.getByRole("switch", { name: "Enable acme/storefront" }),
  ).toBeChecked(T);
} finally {
  await runtime.close();
}
