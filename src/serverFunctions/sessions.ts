import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { GitHubOffError, listAccessibleRepos } from "@/server/github";
import { enabledRepositories } from "@/server/repositories";
import * as sessions from "@/server/sessions";
import { actorFor } from "@/server/users";

export const getSessions = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.listSessionsInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.listSessions(await actorFor(context.user), data),
  );

export const getSession = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.sessionIdInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.getSession(await actorFor(context.user), data.id),
  );

/** What the new-session form offers: enabled repositories, or GitHub off. */
export const getNewSessionOptions = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context }) => {
    await actorFor(context.user);
    try {
      // A cheap call that tells whether GitHub answers at all.
      await listAccessibleRepos();
    } catch (error) {
      if (error instanceof GitHubOffError)
        return { githubOff: true as const, repos: [] };
      throw error;
    }
    return {
      githubOff: false as const,
      repos: await enabledRepositories(context.user.orgId),
    };
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.createSessionInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.createSession(await actorFor(context.user), data),
  );

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.sendMessageInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.sendMessage(await actorFor(context.user), data),
  );

export const stopSession = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.sessionIdInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.stopSession(await actorFor(context.user), data),
  );

export const setSessionVisibility = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => sessions.setVisibilityInput.parse(data))
  .handler(async ({ data, context }) =>
    sessions.setVisibility(await actorFor(context.user), data),
  );
