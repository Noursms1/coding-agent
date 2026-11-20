import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessionEvents, sessions, transcript, users } from "@/db/schema";
import { appendEvent } from "@/server/events";
import { GitHubOffError } from "@/server/github";
import { notesForRepo } from "@/server/notes";
import { complete, ModelError, type ChatMessage } from "@/server/agent/model";
import { readFile, runTool, toolsFor } from "@/server/agent/tools";
import type { SessionStatus } from "@/shared/sessions";

type Session = typeof sessions.$inferSelect;

/** Model turns one run may take before it pauses for the member. */
export const MAX_TURNS = 40;
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

const load = async (id: string) =>
  (await db.select().from(sessions).where(eq(sessions.id, id)))[0] ?? null;

/** Moves a queued session to working. False when it was stopped meanwhile. */
export async function beginRun(sessionId: string): Promise<boolean> {
  const [row] = await db
    .update(sessions)
    .set({ status: "working", updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "queued")))
    .returning({ id: sessions.id });
  return Boolean(row);
}

type TurnResult = { done: boolean; asked?: boolean; error?: string };

/** A turn, with the failures a retry can't fix turned into a result. */
export async function safeTurn(sessionId: string): Promise<TurnResult> {
  try {
    return await agentTurn(sessionId);
  } catch (error) {
    if (error instanceof ModelError)
      return { done: true, error: error.message };
    if (error instanceof GitHubOffError)
      return { done: true, error: "GitHub is not set up." };
    throw error;
  }
}

/** One model turn: read what's new, ask the model, run the tools it picked. */
async function agentTurn(sessionId: string): Promise<TurnResult> {
  let session = await load(sessionId);
  if (!session || session.status !== "working") return { done: true };

  const history = await db
    .select({ message: transcript.message })
    .from(transcript)
    .where(eq(transcript.sessionId, sessionId))
    .orderBy(asc(transcript.id));
  const messages: ChatMessage[] = history.map(
    (h) => JSON.parse(h.message) as ChatMessage,
  );
  const added: ChatMessage[] = [];
  if (!messages.length)
    added.push({ role: "system", content: await systemPrompt(session) });
  const inbox = await readInbox(session, messages.length === 0);
  added.push(...inbox.messages);

  const reply = await complete(
    session.orgId,
    [...messages, ...added],
    toolsFor(session.mode),
  );
  added.push(reply);
  let asked = false;
  for (const call of reply.tool_calls ?? []) {
    session = (await load(sessionId))!;
    if (session.status === "stopped") break;
    const outcome = await runTool(
      session,
      call.function.name,
      call.function.arguments,
    );
    asked ||= Boolean(outcome.asked);
    added.push({
      role: "tool",
      tool_call_id: call.id,
      content: outcome.result,
    });
  }
  // Answer any call skipped by a stop, so the transcript stays well-formed.
  for (const call of reply.tool_calls ?? []) {
    if (!added.some((m) => m.role === "tool" && m.tool_call_id === call.id)) {
      added.push({
        role: "tool",
        tool_call_id: call.id,
        content: "Skipped: the session was stopped.",
      });
    }
  }
  // The transcript and the inbox position move together, so a retried turn re-reads its messages.
  await db.batch([
    db
      .insert(transcript)
      .values(added.map((m) => ({ sessionId, message: JSON.stringify(m) }))),
    db
      .update(sessions)
      .set({
        inboxSeq: inbox.last,
        wake: sql`exists (select 1 from session_events where session_id = ${sessionId} and seq > ${inbox.last} and (kind = 'user' or data like '%"inbox"%'))`,
      })
      .where(eq(sessions.id, sessionId)),
  ]);
  if (!reply.tool_calls?.length && reply.content?.trim()) {
    await appendEvent(sessionId, { kind: "agent", body: reply.content.trim() });
  }
  return { done: asked || !reply.tool_calls?.length, asked };
}

/** New messages, check failures and reviews since the last turn, as user messages. */
async function readInbox(session: Session, first: boolean) {
  const events = await db
    .select({
      seq: sessionEvents.seq,
      kind: sessionEvents.kind,
      body: sessionEvents.body,
      data: sessionEvents.data,
      email: users.email,
    })
    .from(sessionEvents)
    .leftJoin(users, eq(users.id, sessionEvents.authorId))
    .where(
      and(
        eq(sessionEvents.sessionId, session.id),
        gt(sessionEvents.seq, session.inboxSeq),
      ),
    )
    .orderBy(asc(sessionEvents.seq));
  const out: ChatMessage[] = [];
  let firstUser = first;
  for (const e of events) {
    const inbox = e.data
      ? (JSON.parse(e.data) as { inbox?: string }).inbox
      : undefined;
    if (e.kind === "user") {
      out.push({
        role: "user",
        content: firstUser
          ? e.body
          : `${e.email ?? "A member"} wrote: ${e.body}`,
      });
      firstUser = false;
    } else if (inbox) {
      out.push({ role: "user", content: inbox });
    }
  }
  return { messages: out, last: events.at(-1)?.seq ?? session.inboxSeq };
}

async function systemPrompt(session: Session): Promise<string> {
  const notes = await notesForRepo(session.orgId, session.repoId);
  const files: { name: string; text: string }[] = [];
  for (const name of INSTRUCTION_FILES) {
    try {
      const text = await readFile(session, name, session.baseBranch);
      if (!text.startsWith("Error:"))
        files.push({ name, text: text.slice(0, 8000) });
    } catch (error) {
      if (error instanceof GitHubOffError) throw error;
      // Missing file: nothing to load.
    }
  }
  if (notes.length || files.length) {
    await appendEvent(session.id, {
      kind: "knowledge",
      body: `Loaded ${[...notes.map((n) => n.title), ...files.map((f) => f.name)].join(", ")}`,
      data: {
        notes: notes.map((n) => n.title),
        files: files.map((f) => f.name),
      },
    });
  }
  const lines = [
    "You are a software engineer working on a GitHub repository for a team.",
    `Repository: ${session.repoFullName}. Base branch: ${session.baseBranch}.`,
    session.mode === "build"
      ? `Mode: build. Your branch is ${session.branch}. Start with post_plan, explore with list_files, read_file and search_code, change files with write_file, push with commit, then open_pull_request. Keep changes small and focused. After the pull request, its checks run; when they fail or a reviewer comments you will be told, and you fix it on the same branch.`
      : "Mode: ask. Answer the question about the code. You can read but not change anything.",
    "When you are done, reply with a short plain-text summary and no tool call. Use ask_user only when you cannot continue without an answer.",
  ];
  for (const n of notes)
    lines.push(`\n## Team note: ${n.title}\nUse when: ${n.trigger}\n${n.body}`);
  for (const f of files)
    lines.push(`\n## ${f.name} from the repository\n${f.text}`);
  return lines.join("\n");
}

/**
 * Settles a run: needs input after a question, awaiting checks while a PR's
 * checks are pending, else ready. Guarded on working and no wake, so a
 * message that arrived meanwhile keeps the run going (returns false).
 */
export async function finishRun(
  sessionId: string,
  asked: boolean,
): Promise<boolean> {
  const s = await load(sessionId);
  if (!s || s.status !== "working") return true;
  const rest: SessionStatus = asked
    ? "needs_input"
    : s.prNumber && s.checksState === "pending"
      ? "awaiting_checks"
      : "ready";
  const [row] = await db
    .update(sessions)
    .set({ status: rest, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.status, "working"),
        eq(sessions.wake, 0),
      ),
    )
    .returning({ id: sessions.id });
  return Boolean(row);
}

export async function pauseRun(sessionId: string) {
  await appendEvent(sessionId, {
    kind: "agent",
    body: "I've taken many steps in this run. Reply to let me continue.",
  });
  await db
    .update(sessions)
    .set({ status: "needs_input", updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "working")));
}

export async function failRun(sessionId: string, message: string) {
  await appendEvent(sessionId, { kind: "error", body: message });
  await db
    .update(sessions)
    .set({ status: "failed", updatedAt: new Date().toISOString() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "working")));
}
