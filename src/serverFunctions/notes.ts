import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import * as notes from "@/server/notes";
import { enabledRepositories } from "@/server/repositories";
import { actorFor } from "@/server/users";

export const getNotes = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context }) => {
    const actor = await actorFor(context.user);
    const [list, repos] = await Promise.all([
      notes.listNotes(actor),
      enabledRepositories(actor.orgId),
    ]);
    return { notes: list, repos };
  });

export const createNote = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => notes.createNoteInput.parse(data))
  .handler(async ({ data, context }) =>
    notes.createNote(await actorFor(context.user), data),
  );

export const updateNote = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => notes.updateNoteInput.parse(data))
  .handler(async ({ data, context }) =>
    notes.updateNote(await actorFor(context.user), data),
  );

export const deleteNote = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => notes.deleteNoteInput.parse(data))
  .handler(async ({ data, context }) =>
    notes.deleteNote(await actorFor(context.user), data),
  );
