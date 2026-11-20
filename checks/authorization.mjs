// X001 + every frozen feature's rules: who may read and change what.
import {
  startRuntime,
  expect,
} from "/home/user/oss-new/control/runtime/index.mjs";
import { withFakeGateway, webhook } from "./fake-gateway.mjs";

const T = { timeout: 30000 };
const runtime = await startRuntime(withFakeGateway());
const d1 = await runtime.database();
const db = () => d1;

/** Runs `trigger` on the page and returns the server function call it made. */
async function capture(page, trigger) {
  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.method() === "POST" && r.url().includes("/_serverFn/"),
    ),
    trigger(),
  ]);
  const url = new URL(request.url());
  const headers = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(
      ([k]) =>
        !/^(cookie|host|content-length|origin|referer)$/i.test(k) &&
        !k.startsWith(":"),
    ),
  );
  return {
    path: url.pathname + url.search,
    headers,
    body: request.postData() ?? "",
  };
}
/** Replays a captured call as another role, with one id swapped for another. */
function replay(call, role, from, to) {
  return runtime.fetch(call.path, {
    role,
    method: "POST",
    headers: call.headers,
    body: from ? call.body.replaceAll(from, to) : call.body,
  });
}

/** A server function call the app refused: a perimeter error, or the function's own thrown error. */
async function expectRefused(response) {
  if (response.status >= 400) return;
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("$TSR/Error");
}

try {
  await runtime.assertPrivateAccess([
    "/",
    "/repositories",
    "/knowledge",
    "/sessions/new",
  ]);

  // No sign-in of the app's own: no login page and no password field.
  for (const path of ["/login", "/signin", "/sign-in", "/signup", "/logout"]) {
    const res = await runtime.fetch(path, { role: "member" });
    expect(res.status, path).toBe(404);
  }
  for (const path of ["/login", "/sessions/new"]) {
    const res = await runtime.fetch(path);
    expect(res.status, path).not.toBe(200);
  }

  // The webhook is the only public route: POST with a valid signature only, and it reveals nothing.
  expect((await runtime.fetch("/github/webhooks")).status).not.toBe(200);
  const bad = await runtime.fetch("/github/webhooks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-hub-signature-256": "sha256=00",
    },
    body: "{}",
  });
  expect(bad.status).toBe(401);
  const ping = await runtime.fetch(
    "/github/webhooks",
    webhook("ping", { zen: "hi" }),
  );
  expect(ping.status).toBe(202);
  expect(await ping.text()).not.toMatch(/storefront|session/i);

  // F001: only admins enable repositories.
  const admin = await (await runtime.context("owner")).newPage();
  await admin.goto("/repositories");
  await expect(admin.getByTestId("repo-row")).toHaveCount(2, T);
  const enable = await capture(admin, () =>
    admin.getByRole("switch", { name: "Enable acme/storefront" }).click(),
  );
  await expect(
    admin.getByRole("switch", { name: "Enable acme/storefront" }),
  ).toBeChecked();
  const member = await (await runtime.context("member")).newPage();
  await member.goto("/repositories");
  await expect(member.getByTestId("repo-row")).toHaveCount(1, T);
  await expect(member.getByRole("switch")).toHaveCount(0);
  const forgedEnable = await replay(
    enable,
    "member",
    "acme/storefront",
    "acme/billing-service",
  );
  await expectRefused(forgedEnable);
  const outsiderEnable = await replay(
    enable,
    "outsider",
    "acme/storefront",
    "acme/billing-service",
  );
  await expectRefused(outsiderEnable);
  const enabled = await db()
    .prepare("select full_name from repositories where enabled = 1")
    .all();
  expect(enabled.results.map((r) => r.full_name)).toEqual(["acme/storefront"]);

  // F002: a session is private to its creator.
  await admin.goto("/sessions/new");
  await admin.getByTestId("repo-select").click();
  await admin.getByRole("option", { name: "acme/storefront" }).click();
  await admin.getByTestId("mode-ask").click();
  await admin
    .getByTestId("task-input")
    .fill("Which file computes the cart total?");
  await Promise.all([
    admin.waitForURL(/\/sessions\/[0-9a-f-]{36}$/),
    admin.getByTestId("start-session").click(),
  ]);
  const privateId = admin.url().split("/").pop();
  await expect(admin.getByTestId("session-status")).toHaveText("Ready", T);

  await member.goto("/");
  await expect(
    member.getByText("Which file computes the cart total?"),
  ).toHaveCount(0);
  await member.goto(`/sessions/${privateId}`);
  await expect(member.getByTestId("session-not-found")).toBeVisible(T);
  await expect(
    member.getByText("Which file computes the cart total?"),
  ).toHaveCount(0);
  const html = await (
    await runtime.fetch(`/sessions/${privateId}`, { role: "member" })
  ).text();
  expect(html).not.toContain("Which file computes the cart total?");

  // A second session of the admin's, to capture each action against.
  await admin.goto("/sessions/new");
  await admin.getByTestId("repo-select").click();
  await admin.getByRole("option", { name: "acme/storefront" }).click();
  await admin.getByTestId("mode-ask").click();
  await admin.getByTestId("task-input").fill("Explain the README.");
  await Promise.all([
    admin.waitForURL(/\/sessions\/[0-9a-f-]{36}$/),
    admin.getByTestId("start-session").click(),
  ]);
  const otherId = admin.url().split("/").pop();
  await expect(admin.getByTestId("session-status")).toHaveText("Ready", T);
  await admin.getByTestId("message-input").fill("One more question.");
  const send = await capture(admin, () =>
    admin.getByTestId("send-message").click(),
  );
  const share = await capture(admin, () =>
    admin.getByTestId("share-toggle").click(),
  );
  await expect(admin.getByTestId("share-toggle")).toBeChecked(T);
  const unshare = await capture(admin, () =>
    admin.getByTestId("share-toggle").click(),
  );
  await expect(admin.getByTestId("share-toggle")).not.toBeChecked(T);
  await admin.getByTestId("stop-session").click();
  const stop = await capture(admin, () =>
    admin.getByRole("button", { name: "Stop session" }).click(),
  );
  await expect(admin.getByTestId("session-status")).toHaveText("Stopped", T);

  // Another member can neither message, share, nor stop a private session.
  await expectRefused(await replay(send, "member", otherId, privateId));
  await expectRefused(await replay(share, "member", otherId, privateId));
  await expectRefused(await replay(stop, "member", otherId, privateId));
  await expectRefused(await replay(send, "outsider", otherId, privateId));
  const priv = await db()
    .prepare("select status, visibility from sessions where id = ?")
    .bind(privateId)
    .first();
  expect(priv).toEqual({ status: "ready", visibility: "private" });
  const leaked = await db()
    .prepare(
      "select count(*) as n from session_events where session_id = ? and body like '%One more question%'",
    )
    .bind(privateId)
    .first();
  expect(leaked.n).toBe(0);

  // F005: once shared, members read and message it, but only the owner or an admin stops it or makes it private.
  // The same replayed call works for the owner, so the refusals above are the app's rules.
  const allowed = await replay(share, "owner", otherId, privateId);
  expect(allowed.status).toBe(200);
  expect(await allowed.text()).not.toContain("$TSR/Error");
  await admin.goto(`/sessions/${privateId}`);
  await expect(admin.getByTestId("share-toggle")).toBeChecked(T);
  await member.goto(`/sessions/${privateId}`);
  await expect(member.getByTestId("timeline")).toBeVisible(T);
  await expect(member.getByTestId("stop-session")).toHaveCount(0);
  await expect(member.getByTestId("share-toggle")).toBeDisabled();
  await member.getByTestId("message-input").fill("I can follow along here.");
  await member.getByTestId("send-message").click();
  await expect(member.getByTestId("chat")).toContainText(
    "I can follow along here.",
    T,
  );
  await expectRefused(await replay(stop, "member", otherId, privateId));
  await expectRefused(await replay(unshare, "member", otherId, privateId));
  const shared = await db()
    .prepare("select status, visibility from sessions where id = ?")
    .bind(privateId)
    .first();
  expect(shared.visibility).toBe("organization");
  expect(shared.status).not.toBe("stopped");

  // F004: only the author or an admin edits or deletes a note.
  await admin.goto("/knowledge");
  await admin.getByTestId("new-note").click();
  await admin.getByLabel("Title").fill("Release checklist");
  await admin.getByLabel("When to use").fill("When preparing a release");
  await admin
    .getByLabel("Note", { exact: true })
    .fill("Bump the version and tag it.");
  await admin.getByTestId("save-note").click();
  const adminNote = admin
    .getByTestId("note-row")
    .filter({ hasText: "Release checklist" });
  await expect(adminNote).toBeVisible(T);
  await member.goto("/knowledge");
  const seen = member
    .getByTestId("note-row")
    .filter({ hasText: "Release checklist" });
  await expect(seen).toBeVisible(T);
  await expect(
    seen.getByRole("button", { name: "Delete Release checklist" }),
  ).toHaveCount(0);
  await expect(
    seen.getByRole("button", { name: "Edit Release checklist" }),
  ).toHaveCount(0);

  await member.getByTestId("new-note").click();
  await member.getByLabel("Title").fill("Test data");
  await member.getByLabel("When to use").fill("When writing tests");
  await member
    .getByLabel("Note", { exact: true })
    .fill("Use the fixtures folder.");
  await member.getByTestId("save-note").click();
  const memberNote = member
    .getByTestId("note-row")
    .filter({ hasText: "Test data" });
  await expect(memberNote).toBeVisible(T);
  await memberNote.getByRole("button", { name: "Delete Test data" }).click();
  const del = await capture(member, () =>
    member.getByRole("button", { name: "Delete note" }).click(),
  );
  await expect(memberNote).toHaveCount(0, T);
  const adminNoteId = (
    await db()
      .prepare("select id from notes where title = 'Release checklist'")
      .first()
  ).id;
  const memberNoteId = (
    await db().prepare("select id from notes where title = 'Test data'").first()
  )?.id;
  expect(memberNoteId).toBeUndefined();
  const idMatch = del.body.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  );
  expect(idMatch).not.toBeNull();
  await expectRefused(await replay(del, "member", idMatch[0], adminNoteId));
  expect(
    (
      await db()
        .prepare("select count(*) as n from notes where id = ?")
        .bind(adminNoteId)
        .first()
    ).n,
  ).toBe(1);

  // An admin may edit a member's note.
  await member.getByTestId("new-note").click();
  await member.getByLabel("Title").fill("Branch names");
  await member.getByLabel("When to use").fill("When naming branches");
  await member.getByLabel("Note", { exact: true }).fill("Use kebab-case.");
  await member.getByTestId("save-note").click();
  await expect(
    member.getByTestId("note-row").filter({ hasText: "Branch names" }),
  ).toBeVisible(T);
  await admin.reload();
  await admin.getByRole("button", { name: "Edit Branch names" }).click();
  await admin
    .getByLabel("Note", { exact: true })
    .fill("Use kebab-case, prefixed with the ticket number.");
  await admin.getByTestId("save-note").click();
  await expect(
    admin.getByTestId("note-row").filter({ hasText: "Branch names" }),
  ).toContainText("prefixed with the ticket number", T);
} finally {
  await runtime.close();
}
