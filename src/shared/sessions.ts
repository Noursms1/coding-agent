export const SESSION_STATUSES = [
  "queued",
  "working",
  "needs_input",
  "awaiting_checks",
  "ready",
  "failed",
  "stopped",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const STATUS_LABELS: Record<SessionStatus, string> = {
  queued: "Queued",
  working: "Working",
  needs_input: "Needs input",
  awaiting_checks: "Awaiting checks",
  ready: "Ready",
  failed: "Failed",
  stopped: "Stopped",
};

/** Statuses in which the agent is busy and the page should keep refreshing. */
export const ACTIVE_STATUSES: SessionStatus[] = ["queued", "working"];

/** Event kinds shown in the chat; the rest go to the timeline. */
export const CHAT_KINDS = ["user", "agent"];

/** How many times the agent may try to fix failing checks. */
export const MAX_FIX_ROUNDS = 5;
