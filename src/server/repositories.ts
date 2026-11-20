import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { repositories } from "@/db/schema";
import { listAccessibleRepos, GitHubOffError } from "@/server/github";
import type { Actor } from "@/server/users";

interface RepoRow {
  fullName: string;
  defaultBranch: string;
  enabled: boolean;
}

type RepoList = { githubOff: true } | { githubOff: false; repos: RepoRow[] };

/** Admins see everything GitHub can reach; members see the enabled ones. */
export async function listRepositories(actor: Actor): Promise<RepoList> {
  const saved = await db
    .select()
    .from(repositories)
    .where(eq(repositories.orgId, actor.orgId))
    .orderBy(asc(repositories.fullName));
  let reachable;
  try {
    reachable = await listAccessibleRepos();
  } catch (error) {
    if (error instanceof GitHubOffError) return { githubOff: true };
    throw error;
  }
  const enabled = new Set(
    saved.filter((r) => r.enabled).map((r) => r.fullName),
  );
  const repos = reachable
    .map((r) => ({
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      enabled: enabled.has(r.full_name),
    }))
    .filter((r) => actor.admin || r.enabled)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { githubOff: false, repos };
}

export const setEnabledInput = z
  .object({ fullName: z.string().min(3).max(200), enabled: z.boolean() })
  .strict();

/** Admin only. The repository must be one GitHub currently lets the app reach. */
export async function setRepositoryEnabled(
  actor: Actor,
  input: z.infer<typeof setEnabledInput>,
): Promise<RepoRow> {
  if (!actor.admin) throw new Error("Only admins can change repositories.");
  const repo = (await listAccessibleRepos()).find(
    (r) => r.full_name === input.fullName,
  );
  if (!repo) throw new Error("GitHub doesn't give access to that repository.");
  await db
    .insert(repositories)
    .values({
      id: crypto.randomUUID(),
      orgId: actor.orgId,
      githubId: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      enabled: input.enabled,
      updatedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [repositories.orgId, repositories.fullName],
      set: {
        enabled: input.enabled,
        defaultBranch: repo.default_branch,
        githubId: repo.id,
        updatedBy: actor.id,
        updatedAt: new Date().toISOString(),
      },
    });
  return {
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    enabled: input.enabled,
  };
}

/** Enabled repositories, from what the app stored: no GitHub call. */
export function enabledRepositories(orgId: string) {
  return db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
      defaultBranch: repositories.defaultBranch,
    })
    .from(repositories)
    .where(and(eq(repositories.orgId, orgId), eq(repositories.enabled, true)))
    .orderBy(asc(repositories.fullName));
}
