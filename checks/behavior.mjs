// F001-F005: the main path of each feature, through the packaged release.
import {
  startRuntime,
  expect,
} from "/home/user/oss-new/control/runtime/index.mjs";
import { withFakeGateway, webhook, until } from "./fake-gateway.mjs";

const T = { timeout: 30000 };
const runtime = await startRuntime(withFakeGateway());
const d1 = await runtime.database();
const db = () => d1;
const sessionRow = (id) =>
  db()
    .prepare(
      "select status, branch, head_sha, fix_rounds from sessions where id = ?",
    )
    .bind(id)
    .first();

async function newSession(page, { repo = "acme/storefront", mode, task }) {
  await page.goto("/sessions/new");
  await page.getByTestId("repo-select").click();
  await page.getByRole("option", { name: repo }).click();
  await expect(page.getByTestId("base-branch")).toHaveValue("main");
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId("task-input").fill(task);
  await Promise.all([
    page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/),
    page.getByTestId("start-session").click(),
  ]);
  return page.url().split("/").pop();
}

try {
  // F001: an admin sees what GitHub can reach and enables a repository.
  const admin = await (await runtime.context("owner")).newPage();
  await admin.goto("/repositories");
  await runtime.assertBackLink(admin);
  const rows = admin.getByTestId("repo-row");
  await expect(rows).toHaveCount(2, T);
  await expect(rows.filter({ hasText: "acme/billing-service" })).toContainText(
    "trunk",
  );
  await admin.getByRole("switch", { name: "Enable acme/storefront" }).click();
  await expect(
    admin.getByRole("switch", { name: "Enable acme/storefront" }),
  ).toBeChecked();
  await admin.reload();
  await expect(
    admin.getByRole("switch", { name: "Enable acme/storefront" }),
  ).toBeChecked(T);
  await expect(
    admin.getByRole("switch", { name: "Enable acme/billing-service" }),
  ).not.toBeChecked();

  // F004: a member writes a note pinned to every repository.
  const page = await (await runtime.context("member")).newPage();
  await page.goto("/knowledge");
  await page.getByTestId("new-note").click();
  await page.getByLabel("Title").fill("Money in the cart");
  await page
    .getByLabel("When to use")
    .fill("When changing prices, discounts or totals");
  await page
    .getByLabel("Note", { exact: true })
    .fill(
      "Totals are dollars rounded half up to two decimals. Never store floats in the database.",
    );
  await page.getByTestId("save-note").click();
  await expect(
    page.getByTestId("note-row").filter({ hasText: "Money in the cart" }),
  ).toContainText("All repositories", T);

  // Members only see enabled repositories when starting work.
  await page.goto("/sessions/new");
  await page.getByTestId("repo-select").click();
  await expect(
    page.getByRole("option", { name: "acme/storefront" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "acme/billing-service" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // F002 + F003: a build session plans, explores, edits, commits and opens a PR.
  const id = await newSession(page, {
    mode: "build",
    task: "Discounted cart totals show fractions of a cent. Round them to cents.",
  });
  const status = page.getByTestId("session-status");
  const timeline = page.getByTestId("timeline");
  const chat = page.getByTestId("chat");
  await expect(status).toHaveText("Awaiting checks", T);
  await expect(timeline).toContainText("Round the discounted total to cents");
  await expect(timeline).toContainText("Money in the cart");
  await expect(timeline).toContainText("AGENTS.md");
  await expect(timeline).toContainText("Read src/cart.ts");
  await expect(timeline).toContainText("Edited src/cart.ts");
  await expect(timeline).toContainText("Opened pull request #41");
  await expect(chat).toContainText("I opened a pull request");
  await expect(page.getByTestId("pr-link")).toHaveAttribute(
    "href",
    "https://github.com/acme/storefront/pull/41",
  );
  const first = await sessionRow(id);
  expect(first.branch).toMatch(/^agent\//);

  // Webhooks are signature-checked.
  const suite = (sha, conclusion) => ({
    action: "completed",
    repository: { full_name: "acme/storefront" },
    check_suite: { head_branch: first.branch, head_sha: sha, conclusion },
  });
  const unsigned = await runtime.fetch("/github/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "check_suite",
    },
    body: JSON.stringify(suite(first.head_sha, "failure")),
  });
  expect(unsigned.status).toBe(401);
  const forged = await runtime.fetch(
    "/github/webhooks",
    webhook("check_suite", suite(first.head_sha, "failure"), "wrong-secret"),
  );
  expect(forged.status).toBe(401);
  expect((await sessionRow(id)).status).toBe("awaiting_checks");

  // A failed check hands the agent the output; it pushes a fix to the same branch.
  const failed = await runtime.fetch(
    "/github/webhooks",
    webhook("check_suite", suite(first.head_sha, "failure")),
  );
  expect(failed.status).toBe(202);
  await expect(timeline).toContainText("Checks failed", T);
  await expect(timeline).toContainText("round 1 of 5");
  await expect(chat).toContainText("Pushed a fix", T);
  await expect(status).toHaveText("Awaiting checks", T);
  const second = await sessionRow(id);
  expect(second.branch).toBe(first.branch);
  expect(second.head_sha).not.toBe(first.head_sha);
  expect(second.fix_rounds).toBe(1);

  // All checks passing marks the session ready.
  expect(
    (
      await runtime.fetch(
        "/github/webhooks",
        webhook("check_suite", suite(second.head_sha, "success")),
      )
    ).status,
  ).toBe(202);
  await expect(status).toHaveText("Ready", T);
  await expect(timeline).toContainText("All checks passed");

  // A review on the PR wakes the agent.
  const review = {
    action: "submitted",
    repository: { full_name: "acme/storefront" },
    pull_request: { number: 41, head: { ref: first.branch } },
    review: {
      state: "changes_requested",
      body: "Please add a comment explaining the rounding.",
      user: { login: "rivera" },
    },
  };
  expect(
    (
      await runtime.fetch(
        "/github/webhooks",
        webhook("pull_request_review", review),
      )
    ).status,
  ).toBe(202);
  await expect(timeline).toContainText(
    "Please add a comment explaining the rounding.",
    T,
  );
  await expect(chat).toContainText(
    "Added a comment explaining the rounding",
    T,
  );
  await expect(status).toHaveText("Awaiting checks", T);
  const third = await sessionRow(id);
  expect(
    (
      await runtime.fetch(
        "/github/webhooks",
        webhook("check_suite", suite(third.head_sha, "success")),
      )
    ).status,
  ).toBe(202);
  await expect(status).toHaveText("Ready", T);

  // A follow-up message at any time gets an answer in the chat.
  await page.getByTestId("message-input").fill("Thanks, that covers it.");
  await page.getByTestId("send-message").click();
  await expect(chat).toContainText("Thanks, that covers it.");
  await expect(chat).toContainText("Understood.", T);

  // Ask mode answers in chat and never writes.
  const askId = await newSession(page, {
    mode: "ask",
    task: "Where are discounts applied to the cart total?",
  });
  await expect(page.getByTestId("session-status")).toHaveText("Ready", T);
  await expect(page.getByTestId("chat")).toContainText(
    "Discounts are applied in total()",
  );
  await expect(page.getByTestId("pr-link")).toHaveCount(0);
  expect((await sessionRow(askId)).head_sha).toBeNull();

  // The agent can pause to ask; a reply resumes it. Then the member stops it.
  const askingId = await newSession(page, {
    mode: "build",
    task: "Round cart totals, but ask me first how to round.",
  });
  await expect(page.getByTestId("session-status")).toHaveText("Needs input", T);
  await expect(page.getByTestId("chat")).toContainText(
    "Should totals round half up to whole cents?",
  );
  await page.getByTestId("message-input").fill("Yes, round half up.");
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("session-status")).toHaveText(
    "Awaiting checks",
    T,
  );
  await page.getByTestId("stop-session").click();
  await page.getByRole("button", { name: "Stop session" }).click();
  await expect(page.getByTestId("session-status")).toHaveText("Stopped", T);
  await expect(page.getByTestId("message-input")).toHaveCount(0);
  expect((await sessionRow(askingId)).status).toBe("stopped");

  // The list: title, repo, status, PR link and time, filterable by status.
  await page.goto("/");
  const list = page.getByTestId("session-row");
  await expect(list).toHaveCount(3, T);
  const main = list.filter({ hasText: "Discounted cart totals" });
  await expect(main).toContainText("acme/storefront");
  await expect(main).toContainText("Ready");
  await expect(main.getByRole("link", { name: "#41" })).toHaveAttribute(
    "href",
    "https://github.com/acme/storefront/pull/41",
  );
  await expect(main.locator("time")).toHaveCount(1);
  await page.getByTestId("status-filter").click();
  await page.getByRole("option", { name: "Stopped" }).click();
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("ask me first");

  // F005: the owner shares a session; another member reads it and joins the chat.
  await page.goto(`/sessions/${id}`);
  await page.getByTestId("share-toggle").click();
  await expect(page.getByTestId("share-toggle")).toBeChecked(T);
  await admin.goto("/");
  await expect(admin.getByTestId("session-row")).toHaveCount(1, T);
  await admin
    .getByTestId("session-row")
    .getByRole("link", { name: /Discounted cart totals/ })
    .click();
  await expect(admin.getByTestId("timeline")).toContainText(
    "Opened pull request #41",
    T,
  );
  await admin
    .getByTestId("message-input")
    .fill("Looks good to me. Merging after lunch.");
  await admin.getByTestId("send-message").click();
  await expect(page.getByTestId("chat")).toContainText(
    "Looks good to me. Merging after lunch.",
    T,
  );

  // Phone-sized smoke.
  const phone = await (
    await runtime.context("member", {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await phone.goto("/");
  await expect(phone.getByRole("heading", { name: "Sessions" })).toBeVisible();
  await expect(phone.getByTestId("session-row").first()).toBeVisible();

  await page.goto(`/sessions/${id}`);
  await expect(page.getByTestId("session-status")).toHaveText(
    /Ready|Awaiting checks/,
    T,
  );
  await runtime.screenshot(page);
} finally {
  await runtime.close();
}

// F001: with GitHub off, the pages say so and no session can target a repository.
const off = await startRuntime({
  bindings: {
    GITHUB_WEBHOOK_SECRET: { type: "text", value: "local-test-webhook-secret" },
  },
});
try {
  const page = await (await off.context("owner")).newPage();
  await page.goto("/repositories");
  await expect(page.getByTestId("github-off")).toBeVisible(T);
  await page.goto("/sessions/new");
  await expect(page.getByTestId("github-off")).toBeVisible(T);
  await expect(page.getByTestId("start-session")).toBeDisabled();
} finally {
  await off.close();
}
