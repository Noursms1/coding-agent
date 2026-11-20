import { env } from "cloudflare:workers";
import {
  gatewayRefusal,
  integrationFetch,
  type GatewayCallFor,
} from "@every-app/sdk/server";

/** GitHub isn't set up on the Gateway, or refused the call outright. */
export class GitHubOffError extends Error {
  constructor(readonly code: string) {
    super("GitHub is not set up.");
  }
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const OFF_CODES = new Set([
  "integration_not_configured",
  "capability_not_requested",
  "integration_not_connected",
]);

/**
 * A call to the GitHub REST API through the Gateway, which adds the token.
 * `for` is left out inside a request; background work names the organization.
 */
export async function github<T>(
  path: string,
  init: { method?: string; body?: unknown; for?: GatewayCallFor } = {},
): Promise<T> {
  const fetchGitHub = integrationFetch({
    env,
    provider: "github",
    ...(init.for ? { for: init.for } : {}),
  });
  const response = await fetchGitHub(`https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "coding-agent",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const refusal = await gatewayRefusal(response.clone());
  if (refusal) {
    if (OFF_CODES.has(refusal.code)) throw new GitHubOffError(refusal.code);
    throw new GitHubError(response.status, refusal.message ?? refusal.code);
  }
  if (!response.ok) {
    const text = await response.text();
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      // Not JSON: keep the text.
    }
    throw new GitHubError(response.status, message);
  }
  return (await response.json()) as T;
}

interface GitHubRepo {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
}

/** Every repository the token can reach, most recently pushed first. */
export async function listAccessibleRepos(): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await github<GitHubRepo[]>(
      `/user/repos?per_page=100&sort=pushed&page=${page}`,
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

export const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");
