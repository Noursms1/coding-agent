import { MAX_FIX_ROUNDS } from "@/shared/sessions";

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  output?: {
    title?: string | null;
    summary?: string | null;
    text?: string | null;
  };
}

const PASSING = new Set(["success", "neutral", "skipped"]);

type ChecksVerdict =
  | { kind: "pending" }
  | { kind: "passed" }
  | { kind: "failed"; failing: CheckRun[] };

/** What a commit's check runs add up to: wait while any runs, else pass or fail. */
export function verdict(runs: CheckRun[]): ChecksVerdict {
  if (!runs.length || runs.some((r) => r.status !== "completed"))
    return { kind: "pending" };
  const failing = runs.filter((r) => !PASSING.has(r.conclusion ?? ""));
  return failing.length ? { kind: "failed", failing } : { kind: "passed" };
}

/** After a failure: another fix round, or give up once the rounds are used. */
export function nextAfterFailure(
  fixRounds: number,
): { action: "fix"; round: number } | { action: "give_up" } {
  return fixRounds >= MAX_FIX_ROUNDS
    ? { action: "give_up" }
    : { action: "fix", round: fixRounds + 1 };
}

/** The failure output handed to the agent. */
export function failureReport(sha: string, failing: CheckRun[]): string {
  const parts = failing.map((r) =>
    [
      `### ${r.name}: ${r.conclusion}`,
      r.output?.title,
      r.output?.summary,
      r.output?.text?.slice(0, 4000),
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `CI checks failed on ${sha.slice(0, 7)}. Fix them on the same branch and commit.\n\n${parts.join("\n\n")}`.slice(
    0,
    12000,
  );
}

/** GitHub's X-Hub-Signature-256 over the raw body, compared in constant time. */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  const expected = [...mac]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const given = header.slice(7).toLowerCase();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
