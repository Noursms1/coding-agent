import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { repositories, sessionEvents, sessions, users } from "@/db/schema";
import { appendEvent } from "@/server/events";
import type { Actor } from "@/server/users";
import { SESSION_STATUSES, type SessionStatus } from "@/shared/sessions";

export const listSessionsInput = z
  .object({ status: z.enum(SESSION_STATUSES).optional() })
  .strict();
export const createSessionInput = z
  .object({
    repoId: z.string().uuid(),
    baseBranch: z
      .string()
      .trim()
      .min(1, "Give a base branch")
      .max(200)
      .regex(
        /^(?!.*\.\.)(?!\/)[A-Za-z0-9._\/-]+(?<!\/)$/,
        "Not a valid branch name",
      ),
    mode: z.enum(["build", "ask"]),
    task: z.string().trim().min(1, "Describe the task").max(20000),
  })
  .strict();
export const sessionIdInput = z.object({ id: z.string().uuid() }).strict();
export const sendMessageInput = z
  .object({ id: z.string().uuid(), body: z.string().trim().min(1).max(20000) })
  .strict();
export const setVisibilityInput = z
  .object({
    id: z.string().uuid(),
    visibility: z.enum(["private", "organization"]),
  })
  .strict();

/** Sessions this member may read: their own, and those shared with the organization. */
function readable(actor: Actor) {
  return and(
    eq(sessions.orgId, actor.orgId),
    or(eq(sessions.ownerId, actor.id), eq(sessions.visibility, "organization")),
  );
}

/** The owner, or an admin once the session is shared, may stop it or make it private. */
function canManage(actor: Actor, s: { ownerId: string; visibility: string }) {
  return (
    s.ownerId === actor.id || (actor.admin && s.visibility === "organization")
  );
}

export async function listSessions(
  actor: Actor,
  { status }: z.infer<typeof listSessionsInput>,
) {
  return db
    .select({
      id: sessions.id,
      title: sessions.title,
      repoFullName: sessions.repoFullName,
      status: sessions.status,
      mode: sessions.mode,
      prNumber: sessions.prNumber,
      prUrl: sessions.prUrl,
      shared: sql<boolean>`${sessions.visibility} = 'organization'`.mapWith(
        Boolean,
      ),
      mine: sql<boolean>`${sessions.ownerId} = ${actor.id}`.mapWith(Boolean),
      ownerEmail: users.email,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .leftJoin(users, eq(users.id, sessions.ownerId))
    .where(
      and(readable(actor), status ? eq(sessions.status, status) : undefined),
    )
    .orderBy(desc(sessions.updatedAt))
    .limit(200);
}

async function findReadable(actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), readable(actor)));
  return row ?? null;
}

export async function getSession(actor: Actor, id: string) {
  const s = await findReadable(actor, id);
  if (!s) return null;
  const events = await db
    .select({
      id: sessionEvents.id,
      seq: sessionEvents.seq,
      kind: sessionEvents.kind,
      body: sessionEvents.body,
      data: sessionEvents.data,
      authorEmail: users.email,
      createdAt: sessionEvents.createdAt,
    })
    .from(sessionEvents)
    .leftJoin(users, eq(users.id, sessionEvents.authorId))
    .where(eq(sessionEvents.sessionId, id))
    .orderBy(asc(sessionEvents.seq));
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, s.ownerId));
  return {
    session: {
      id: s.id,
      title: s.title,
      repoFullName: s.repoFullName,
      baseBranch: s.baseBranch,
      branch: s.branch,
      mode: s.mode,
      status: s.status,
      visibility: s.visibility,
      prNumber: s.prNumber,
      prUrl: s.prUrl,
      fixRounds: s.fixRounds,
      createdAt: s.createdAt,
      ownerEmail: owner?.email ?? null,
    },
    events: events.map((e) => ({ ...e, data: eventData(e.data) })),
    canManage: canManage(actor, s),
    isOwner: s.ownerId === actor.id,
  };
}

export async function createSession(
  actor: Actor,
  input: z.infer<typeof createSessionInput>,
) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, input.repoId),
        eq(repositories.orgId, actor.orgId),
        eq(repositories.enabled, true),
      ),
    );
  if (!repo) throw new Error("That repository isn't enabled.");
  const id = crypto.randomUUID();
  const firstLine = input.task.split("\n")[0]!.trim();
  await db.insert(sessions).values({
    id,
    orgId: actor.orgId,
    ownerId: actor.id,
    repoId: repo.id,
    repoFullName: repo.fullName,
    baseBranch: input.baseBranch,
    branch: `agent/${id.replaceAll("-", "").slice(0, 12)}`,
    mode: input.mode,
    title: firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine,
    status: "queued",
    wake: 1,
  });
  await appendEvent(id, { kind: "user", body: input.task, authorId: actor.id });
  await startRun(id, actor.orgId);
  return { id };
}

export async function sendMessage(
  actor: Actor,
  input: z.infer<typeof sendMessageInput>,
) {
  const s = await findReadable(actor, input.id);
  if (!s) throw new Error("Session not found.");
  if (s.status === "stopped") throw new Error("This session is stopped.");
  await appendEvent(s.id, {
    kind: "user",
    body: input.body,
    authorId: actor.id,
  });
  await wake(s.id, s.orgId);
  return { ok: true };
}

export async function stopSession(
  actor: Actor,
  { id }: z.infer<typeof sessionIdInput>,
) {
  const s = await findReadable(actor, id);
  if (!s || !canManage(actor, s)) throw new Error("Session not found.");
  const [row] = await db
    .update(sessions)
    .set({ status: "stopped", updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, id), sql`${sessions.status} <> 'stopped'`))
    .returning({ id: sessions.id });
  if (row)
    await appendEvent(id, {
      kind: "status",
      body: "Stopped",
      authorId: actor.id,
    });
  return { ok: true };
}

export async function setVisibility(
  actor: Actor,
  { id, visibility }: z.infer<typeof setVisibilityInput>,
) {
  const s = await findReadable(actor, id);
  if (!s) throw new Error("Session not found.");
  // Only the owner shares; the owner or an admin makes it private again.
  const allowed =
    visibility === "organization"
      ? s.ownerId === actor.id
      : canManage(actor, s);
  if (!allowed)
    throw new Error("Only the owner can change who sees this session.");
  if (s.visibility === visibility) return { ok: true };
  await db.update(sessions).set({ visibility }).where(eq(sessions.id, id));
  await appendEvent(id, {
    kind: "status",
    body:
      visibility === "organization"
        ? "Shared with the organization"
        : "Made private",
    authorId: actor.id,
  });
  return { ok: true };
}

const RESTING: SessionStatus[] = [
  "needs_input",
  "awaiting_checks",
  "ready",
  "failed",
];

/** Tells the agent something new arrived, starting a run when it is idle. */
export async function wake(sessionId: string, orgId: string) {
  await db.update(sessions).set({ wake: 1 }).where(eq(sessions.id, sessionId));
  const [row] = await db
    .update(sessions)
    .set({ status: "queued", updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sessionId), inArray(sessions.status, RESTING)))
    .returning({ id: sessions.id });
  if (row) await startRun(sessionId, orgId);
}

async function startRun(sessionId: string, orgId: string) {
  await env.AGENT_RUN.create({
    id: `${sessionId.slice(0, 8)}-${crypto.randomUUID()}`,
    params: { sessionId, orgId },
  });
}

/** What the page shows of an event's details. */
interface EventData {
  steps?: string[];
  files?: string[];
  passed?: boolean;
}

function eventData(raw: string | null): EventData | null {
  if (!raw) return null;
  const d = JSON.parse(raw) as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : undefined;
  return {
    steps: strings(d.steps),
    files: strings(d.files),
    passed: typeof d.passed === "boolean" ? d.passed : undefined,
  };
}
