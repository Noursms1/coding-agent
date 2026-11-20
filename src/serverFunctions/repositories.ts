import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import * as repos from "@/server/repositories";
import { actorFor } from "@/server/users";

export const getRepositories = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context }) => {
    const actor = await actorFor(context.user);
    return { isAdmin: actor.admin, list: await repos.listRepositories(actor) };
  });

export const setRepositoryEnabled = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => repos.setEnabledInput.parse(data))
  .handler(async ({ data, context }) =>
    repos.setRepositoryEnabled(await actorFor(context.user), data),
  );
