import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);

/** Members the app has seen, keyed by the Gateway's user id. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  createdAt: createdAt(),
});

/** Repositories an admin has turned on or off. */
export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    githubId: integer("github_id").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    updatedBy: text("updated_by").notNull(),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("repositories_org_name").on(t.orgId, t.fullName)],
);

/** One task handed to the agent. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerId: text("owner_id").notNull(),
    repoId: text("repo_id").notNull(),
    repoFullName: text("repo_full_name").notNull(),
    baseBranch: text("base_branch").notNull(),
    branch: text("branch").notNull(),
    mode: text("mode", { enum: ["build", "ask"] }).notNull(),
    title: text("title").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "working",
        "needs_input",
        "awaiting_checks",
        "ready",
        "failed",
        "stopped",
      ],
    }).notNull(),
    visibility: text("visibility", { enum: ["private", "organization"] })
      .notNull()
      .default("private"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    headSha: text("head_sha"),
    checksState: text("checks_state", {
      enum: ["none", "pending", "passed", "failed"],
    })
      .notNull()
      .default("none"),
    fixRounds: integer("fix_rounds").notNull().default(0),
    // Set when something new arrived for the agent; cleared when it reads it.
    wake: integer("wake").notNull().default(0),
    // The last event already handed to the model.
    inboxSeq: integer("inbox_seq").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_repo_branch").on(t.repoFullName, t.branch),
    index("sessions_org_owner").on(t.orgId, t.ownerId),
  ],
);

/** The timeline and chat of a session, append-only. */
export const sessionEvents = sqliteTable(
  "session_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    authorId: text("author_id"),
    body: text("body").notNull(),
    data: text("data"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("session_events_seq").on(t.sessionId, t.seq)],
);

/** The model conversation, one message per row. */
export const transcript = sqliteTable(
  "transcript",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    message: text("message").notNull(),
  },
  (t) => [index("transcript_session").on(t.sessionId, t.id)],
);

/** Edits the agent has written but not yet committed. */
export const stagedFiles = sqliteTable(
  "staged_files",
  {
    sessionId: text("session_id").notNull(),
    path: text("path").notNull(),
    content: text("content").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.path] })],
);

/** Context the agent loads at the start of a session. */
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  authorId: text("author_id").notNull(),
  title: text("title").notNull(),
  trigger: text("trigger").notNull(),
  body: text("body").notNull(),
  // Null: every repository.
  repoId: text("repo_id"),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

/** GitHub deliveries already handled, so a redelivery does nothing. */
export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  createdAt: createdAt(),
});
