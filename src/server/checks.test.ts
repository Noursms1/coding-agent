import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  failureReport,
  nextAfterFailure,
  verdict,
  verifySignature,
} from "./checks";

const run = (name: string, status: string, conclusion: string | null) => ({
  name,
  status,
  conclusion,
});

describe("check verdicts", () => {
  it("waits while any run is still going", () => {
    expect(
      verdict([
        run("lint", "completed", "success"),
        run("test", "in_progress", null),
      ]),
    ).toEqual({ kind: "pending" });
    expect(verdict([])).toEqual({ kind: "pending" });
  });
  it("passes when every run succeeded or was skipped", () => {
    expect(
      verdict([
        run("lint", "completed", "success"),
        run("e2e", "completed", "skipped"),
      ]),
    ).toEqual({ kind: "passed" });
  });
  it("fails on any failing run and names it", () => {
    const v = verdict([
      run("lint", "completed", "success"),
      run("test", "completed", "failure"),
    ]);
    expect(v.kind).toBe("failed");
    expect(v.kind === "failed" && v.failing.map((r) => r.name)).toEqual([
      "test",
    ]);
    expect(
      failureReport("abcdef123", [run("test", "completed", "failure")]),
    ).toMatch(/^CI checks failed on abcdef1/);
  });
  it("allows five fix rounds, then gives up", () => {
    expect(nextAfterFailure(0)).toEqual({ action: "fix", round: 1 });
    expect(nextAfterFailure(4)).toEqual({ action: "fix", round: 5 });
    expect(nextAfterFailure(5)).toEqual({ action: "give_up" });
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ zen: "hi" });
  const sign = (secret: string) =>
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  it("accepts GitHub's signature and refuses anything else", async () => {
    expect(await verifySignature("s3cret", body, sign("s3cret"))).toBe(true);
    expect(await verifySignature("s3cret", body, sign("other"))).toBe(false);
    expect(await verifySignature("s3cret", body + " ", sign("s3cret"))).toBe(
      false,
    );
    expect(await verifySignature("s3cret", body, null)).toBe(false);
  });
});
