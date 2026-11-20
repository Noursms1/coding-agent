import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, stagedFiles } from "@/db/schema";
import { appendEvent } from "@/server/events";
import { encodePath, github, GitHubError } from "@/server/github";
import type { ToolSpec } from "@/server/agent/model";

type Session = typeof sessions.$inferSelect;

const fn = (
  name: string,
  description: string,
  properties: object,
  required: string[] = [],
): ToolSpec => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
const str = (description: string) => ({ type: "string", description });

const READ_TOOLS = [
  fn(
    "list_files",
    "List the repository's files, optionally under a directory.",
    { path: str("Directory prefix, e.g. src/") },
  ),
  fn(
    "read_file",
    "Read one file.",
    { path: str("Path from the repository root") },
    ["path"],
  ),
  fn(
    "search_code",
    "Search the repository's default branch for text.",
    { query: str("Words or an identifier") },
    ["query"],
  ),
  fn(
    "ask_user",
    "Ask the member a question and wait for their reply. Use only when you cannot go on without an answer.",
    { question: str("The question") },
    ["question"],
  ),
];
const WRITE_TOOLS = [
  fn(
    "post_plan",
    "Share a short plan before changing code.",
    {
      steps: {
        type: "array",
        items: { type: "string" },
        description: "3 to 7 short steps",
      },
    },
    ["steps"],
  ),
  fn(
    "write_file",
    "Create or replace a file with its full new content. Nothing is pushed until commit.",
    {
      path: str("Path from the repository root"),
      content: str("The whole file"),
    },
    ["path", "content"],
  ),
  fn(
    "delete_file",
    "Delete a file. Nothing is pushed until commit.",
    { path: str("Path from the repository root") },
    ["path"],
  ),
  fn(
    "commit",
    "Commit every written file to the session's branch and push it.",
    { message: str("Commit message") },
    ["message"],
  ),
  fn(
    "open_pull_request",
    "Open a pull request from the session's branch into the base branch.",
    { title: str("Title"), body: str("Description") },
    ["title", "body"],
  ),
];

export function toolsFor(mode: Session["mode"]): ToolSpec[] {
  return mode === "build" ? [...WRITE_TOOLS, ...READ_TOOLS] : READ_TOOLS;
}

const MAX_RESULT = 12000;
const clip = (text: string) =>
  text.length > MAX_RESULT
    ? `${text.slice(0, MAX_RESULT)}\n…(truncated)`
    : text;

interface ToolOutcome {
  result: string;
  /** The agent asked a question and waits for a reply. */
  asked?: boolean;
}

/** Runs one tool call for a session. Errors come back as text for the model. */
export async function runTool(
  session: Session,
  name: string,
  rawArgs: string,
): Promise<ToolOutcome> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
  } catch {
    return { result: "Error: the arguments were not valid JSON." };
  }
  const s = (key: string) =>
    typeof args[key] === "string" ? (args[key] as string) : "";
  const forOrg = {
    for: { background: true as const, organizationId: session.orgId },
  };
  const repo = `/repos/${session.repoFullName}`;
  const ref = session.headSha ? session.branch : session.baseBranch;
  const writes = session.mode === "build";
  try {
    switch (name) {
      case "list_files": {
        const tree = await github<{
          tree: { path: string; type: string }[];
          truncated: boolean;
        }>(`${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, forOrg);
        const prefix = s("path").replace(/^\/+/, "");
        const paths = tree.tree
          .filter((e) => e.type === "blob" && e.path.startsWith(prefix))
          .map((e) => e.path);
        await appendEvent(session.id, {
          kind: "step",
          body: prefix ? `Listed files in ${prefix}` : "Listed files",
        });
        return {
          result: clip(paths.slice(0, 1500).join("\n") || "(no files)"),
        };
      }
      case "read_file": {
        const path = s("path").replace(/^\/+/, "");
        const [staged] = await db
          .select()
          .from(stagedFiles)
          .where(
            and(
              eq(stagedFiles.sessionId, session.id),
              eq(stagedFiles.path, path),
            ),
          );
        await appendEvent(session.id, { kind: "step", body: `Read ${path}` });
        if (staged) return { result: clip(staged.content) };
        return { result: clip(await readFile(session, path, ref)) };
      }
      case "search_code": {
        const query = s("query").slice(0, 120);
        const found = await github<{ items: { path: string }[] }>(
          `/search/code?q=${encodeURIComponent(`${query} repo:${session.repoFullName}`)}&per_page=30`,
          forOrg,
        );
        await appendEvent(session.id, {
          kind: "step",
          body: `Searched for “${query}”`,
        });
        return {
          result: found.items.map((i) => i.path).join("\n") || "No matches.",
        };
      }
      case "ask_user": {
        await appendEvent(session.id, {
          kind: "agent",
          body: s("question"),
          data: { question: true },
        });
        return {
          result: "The question was sent. Wait for the reply.",
          asked: true,
        };
      }
      case "post_plan": {
        if (!writes) break;
        const steps = Array.isArray(args.steps)
          ? args.steps
              .filter((x): x is string => typeof x === "string")
              .slice(0, 10)
          : [];
        await appendEvent(session.id, {
          kind: "plan",
          body: "Plan",
          data: { steps },
        });
        return { result: "Plan shared." };
      }
      case "write_file":
      case "delete_file": {
        if (!writes) break;
        const path = s("path").replace(/^\/+/, "");
        if (!path || path.includes("..") || path.startsWith(".git/"))
          return { result: "Error: not a valid path." };
        // A deletion is staged as a null-content marker.
        const content = name === "write_file" ? s("content") : "\u0000deleted";
        await db
          .insert(stagedFiles)
          .values({ sessionId: session.id, path, content })
          .onConflictDoUpdate({
            target: [stagedFiles.sessionId, stagedFiles.path],
            set: { content },
          });
        await appendEvent(session.id, {
          kind: "step",
          body: name === "write_file" ? `Edited ${path}` : `Deleted ${path}`,
        });
        return { result: `Staged ${path}. Call commit to push it.` };
      }
      case "commit": {
        if (!writes) break;
        return {
          result: await commit(session, s("message") || "Update files"),
        };
      }
      case "open_pull_request": {
        if (!writes) break;
        if (session.prNumber)
          return {
            result: `Pull request #${session.prNumber} is already open; commits update it.`,
          };
        if (!session.headSha)
          return {
            result: "Error: commit your changes before opening a pull request.",
          };
        const pr = await github<{ number: number; html_url: string }>(
          `${repo}/pulls`,
          {
            ...forOrg,
            method: "POST",
            body: {
              title: s("title").slice(0, 200),
              body: s("body"),
              head: session.branch,
              base: session.baseBranch,
            },
          },
        );
        await db
          .update(sessions)
          .set({
            prNumber: pr.number,
            prUrl: pr.html_url,
            checksState: "pending",
          })
          .where(eq(sessions.id, session.id));
        await appendEvent(session.id, {
          kind: "step",
          body: `Opened pull request #${pr.number}`,
          data: { url: pr.html_url },
        });
        return {
          result: `Opened pull request #${pr.number}. Its checks run now; you'll be told if they fail.`,
        };
      }
    }
    return { result: `Error: ${name} isn't available in this session.` };
  } catch (error) {
    if (error instanceof GitHubError)
      return { result: `GitHub error ${error.status}: ${error.message}` };
    throw error;
  }
}

export async function readFile(session: Session, path: string, ref: string) {
  const file = await github<{
    type: string;
    content?: string;
    encoding?: string;
  }>(
    `/repos/${session.repoFullName}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    { for: { background: true, organizationId: session.orgId } },
  );
  if (file.type !== "file" || file.content === undefined)
    return "Error: not a file.";
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), (c) =>
    c.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

/** Commits the staged files to the session's own branch, never the base. */
async function commit(session: Session, message: string): Promise<string> {
  const staged = await db
    .select()
    .from(stagedFiles)
    .where(eq(stagedFiles.sessionId, session.id));
  if (!staged.length) return "Nothing to commit: write files first.";
  if (
    !session.branch.startsWith("agent/") ||
    session.branch === session.baseBranch
  ) {
    throw new Error("Refusing to push outside the session's branch.");
  }
  const forOrg = {
    for: { background: true as const, organizationId: session.orgId },
  };
  const repo = `/repos/${session.repoFullName}`;
  const ref = (branch: string) => `${repo}/git/ref/heads/${encodePath(branch)}`;
  let parent: string;
  try {
    parent = (
      await github<{ object: { sha: string } }>(ref(session.branch), forOrg)
    ).object.sha;
  } catch (error) {
    if (!(error instanceof GitHubError) || error.status !== 404) throw error;
    parent = (
      await github<{ object: { sha: string } }>(ref(session.baseBranch), forOrg)
    ).object.sha;
    await github(`${repo}/git/refs`, {
      ...forOrg,
      method: "POST",
      body: { ref: `refs/heads/${session.branch}`, sha: parent },
    });
  }
  const baseTree = (
    await github<{ tree: { sha: string } }>(
      `${repo}/git/commits/${parent}`,
      forOrg,
    )
  ).tree.sha;
  const tree = await github<{ sha: string }>(`${repo}/git/trees`, {
    ...forOrg,
    method: "POST",
    body: {
      base_tree: baseTree,
      tree: staged.map((f) =>
        f.content === "\u0000deleted"
          ? { path: f.path, mode: "100644", type: "blob", sha: null }
          : { path: f.path, mode: "100644", type: "blob", content: f.content },
      ),
    },
  });
  const created = await github<{ sha: string }>(`${repo}/git/commits`, {
    ...forOrg,
    method: "POST",
    body: { message, tree: tree.sha, parents: [parent] },
  });
  await github(`${repo}/git/refs/heads/${encodePath(session.branch)}`, {
    ...forOrg,
    method: "PATCH",
    body: { sha: created.sha, force: false },
  });
  await db.batch([
    db.delete(stagedFiles).where(eq(stagedFiles.sessionId, session.id)),
    db
      .update(sessions)
      .set({
        headSha: created.sha,
        checksState: sql`case when ${sessions.prNumber} is null then 'none' else 'pending' end`,
      })
      .where(eq(sessions.id, session.id)),
  ]);
  await appendEvent(session.id, {
    kind: "step",
    body: `Committed “${message.split("\n")[0]}” to ${session.branch}`,
    data: { files: staged.map((f) => f.path) },
  });
  return `Pushed ${created.sha.slice(0, 7)} to ${session.branch}.`;
}
