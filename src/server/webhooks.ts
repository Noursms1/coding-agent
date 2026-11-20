import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { sessions, webhookDeliveries } from "@/db/schema";
import {
  failureReport,
  nextAfterFailure,
  verdict,
  verifySignature,
  type CheckRun,
} from "@/server/checks";
import { appendEvent } from "@/server/events";
import { github } from "@/server/github";
import { wake } from "@/server/sessions";
import { MAX_FIX_ROUNDS } from "@/shared/sessions";

/** Handles one GitHub delivery. Answers 401 unless GitHub signed it. */
export async function handleGitHubWebhook(request: Request): Promise<Response> {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  const body = await request.text();
  if (
    !(await verifySignature(
      secret,
      body,
      request.headers.get("x-hub-signature-256"),
    ))
  ) {
    return new Response(null, { status: 401 });
  }
  const delivery = request.headers.get("x-github-delivery");
  if (delivery) {
    const [fresh] = await db
      .insert(webhookDeliveries)
      .values({ id: delivery.slice(0, 100) })
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    if (!fresh) return new Response(null, { status: 202 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  await route(event, payload);
  return new Response(null, { status: 202 });
}

interface Payload {
  action?: string;
  repository?: { full_name?: string };
  check_suite?: { head_branch?: string | null; head_sha?: string };
  check_run?: {
    head_sha?: string;
    check_suite?: { head_branch?: string | null };
  };
  pull_request?: { number?: number; head?: { ref?: string } };
  issue?: { number?: number; pull_request?: unknown };
  review?: { state?: string; body?: string | null; user?: { login?: string } };
  comment?: { body?: string; path?: string; user?: { login?: string } };
}

async function route(event: string, p: Payload) {
  const repo = p.repository?.full_name;
  if (!repo) return;
  if (
    (event === "check_suite" || event === "check_run") &&
    p.action === "completed"
  ) {
    const branch =
      p.check_suite?.head_branch ?? p.check_run?.check_suite?.head_branch;
    const sha = p.check_suite?.head_sha ?? p.check_run?.head_sha;
    if (branch && sha) await onChecks(repo, branch, sha);
    return;
  }
  if (event === "pull_request_review" && p.action === "submitted") {
    const text = p.review?.body?.trim();
    const state = p.review?.state?.toLowerCase();
    if (state === "approved" && !text) return;
    const verb =
      state === "changes_requested"
        ? "requested changes"
        : state === "approved"
          ? "approved"
          : "reviewed";
    await onReview(
      repo,
      { branch: p.pull_request?.head?.ref },
      p.review?.user?.login,
      verb,
      text ?? "",
    );
    return;
  }
  if (event === "pull_request_review_comment" && p.action === "created") {
    const where = p.comment?.path ? ` on ${p.comment.path}` : "";
    await onReview(
      repo,
      { branch: p.pull_request?.head?.ref },
      p.comment?.user?.login,
      `commented${where}`,
      p.comment?.body ?? "",
    );
    return;
  }
  if (
    event === "issue_comment" &&
    p.action === "created" &&
    p.issue?.pull_request &&
    p.issue.number
  ) {
    await onReview(
      repo,
      { number: p.issue.number },
      p.comment?.user?.login,
      "commented",
      p.comment?.body ?? "",
    );
  }
}

async function findSession(
  repo: string,
  at: { branch?: string; number?: number },
) {
  const match = at.branch
    ? eq(sessions.branch, at.branch)
    : at.number
      ? eq(sessions.prNumber, at.number)
      : null;
  if (!match) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.repoFullName, repo), match));
  return s && s.status !== "stopped" && s.mode === "build" ? s : null;
}

async function onChecks(repo: string, branch: string, sha: string) {
  const s = await findSession(repo, { branch });
  // Only the branch's current commit counts, and only once per commit.
  if (!s || s.headSha !== sha || s.checksState !== "pending") return;
  const { check_runs } = await github<{ check_runs: CheckRun[] }>(
    `/repos/${repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`,
    { for: { background: true, organizationId: s.orgId } },
  );
  const v = verdict(check_runs);
  if (v.kind === "pending") return;
  if (v.kind === "passed") {
    const [row] = await db
      .update(sessions)
      .set({ checksState: "passed" })
      .where(
        and(
          eq(sessions.id, s.id),
          eq(sessions.headSha, sha),
          eq(sessions.checksState, "pending"),
        ),
      )
      .returning({ id: sessions.id });
    if (!row) return;
    await appendEvent(s.id, {
      kind: "checks",
      body: "All checks passed",
      data: { passed: true },
    });
    await db
      .update(sessions)
      .set({ status: "ready", updatedAt: new Date().toISOString() })
      .where(
        and(eq(sessions.id, s.id), eq(sessions.status, "awaiting_checks")),
      );
    return;
  }
  const next = nextAfterFailure(s.fixRounds);
  const [row] = await db
    .update(sessions)
    .set({
      checksState: "failed",
      fixRounds: next.action === "fix" ? next.round : s.fixRounds,
    })
    .where(
      and(
        eq(sessions.id, s.id),
        eq(sessions.headSha, sha),
        eq(sessions.checksState, "pending"),
      ),
    )
    .returning({ id: sessions.id });
  if (!row) return;
  const names = v.failing.map((r) => r.name).join(", ");
  if (next.action === "give_up") {
    await appendEvent(s.id, {
      kind: "error",
      body: `Checks still failing (${names}) after ${MAX_FIX_ROUNDS} rounds of fixes`,
    });
    await db
      .update(sessions)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(sessions.id, s.id),
          inArray(sessions.status, ["awaiting_checks", "queued", "working"]),
        ),
      );
    return;
  }
  await appendEvent(s.id, {
    kind: "checks",
    body: `Checks failed: ${names} (round ${next.round} of ${MAX_FIX_ROUNDS})`,
    data: { passed: false, inbox: failureReport(sha, v.failing) },
  });
  await wake(s.id, s.orgId);
}

async function onReview(
  repo: string,
  at: { branch?: string; number?: number },
  login: string | undefined,
  verb: string,
  text: string,
) {
  const s = await findSession(repo, at);
  if (!s || !s.prNumber) return;
  const who = login ? `@${login}` : "A reviewer";
  await appendEvent(s.id, {
    kind: "review",
    body: `${who} ${verb}${text ? `: ${text}` : ""}`,
    data: {
      inbox: `Review on the pull request from ${who} (${verb}):\n${text}\nAddress it on the same branch, then reply with what you changed.`,
    },
  });
  await wake(s.id, s.orgId);
}
