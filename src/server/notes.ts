import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notes, repositories, users } from "@/db/schema";
import type { Actor } from "@/server/users";

const fields = {
  title: z.string().trim().min(1, "Give the note a title").max(120),
  trigger: z.string().trim().min(1, "Say when the note applies").max(300),
  body: z.string().trim().min(1, "Write the note").max(20000),
  repoId: z.string().uuid().nullable(),
};
export const createNoteInput = z.object(fields).strict();
export const updateNoteInput = z
  .object({ id: z.string().uuid(), ...fields })
  .strict();
export const deleteNoteInput = z.object({ id: z.string().uuid() }).strict();

interface NoteRow {
  id: string;
  title: string;
  trigger: string;
  body: string;
  repoId: string | null;
  repoFullName: string | null;
  authorEmail: string | null;
  updatedAt: string;
  canEdit: boolean;
}

export async function listNotes(actor: Actor): Promise<NoteRow[]> {
  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      trigger: notes.trigger,
      body: notes.body,
      repoId: notes.repoId,
      repoFullName: repositories.fullName,
      authorId: notes.authorId,
      authorEmail: users.email,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .leftJoin(repositories, eq(repositories.id, notes.repoId))
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.orgId, actor.orgId))
    .orderBy(desc(notes.updatedAt));
  return rows.map(({ authorId, ...row }) => ({
    ...row,
    canEdit: actor.admin || authorId === actor.id,
  }));
}

async function checkRepo(actor: Actor, repoId: string | null) {
  if (!repoId) return;
  const [repo] = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(
      and(eq(repositories.id, repoId), eq(repositories.orgId, actor.orgId)),
    );
  if (!repo) throw new Error("Unknown repository.");
}

export async function createNote(
  actor: Actor,
  input: z.infer<typeof createNoteInput>,
) {
  await checkRepo(actor, input.repoId);
  const id = crypto.randomUUID();
  await db.insert(notes).values({
    id,
    orgId: actor.orgId,
    authorId: actor.id,
    ...input,
  });
  return { id };
}

/** Author or admin only; null when no note of theirs has the id. */
function editable(actor: Actor, id: string) {
  return and(
    eq(notes.id, id),
    eq(notes.orgId, actor.orgId),
    actor.admin ? undefined : eq(notes.authorId, actor.id),
  );
}

export async function updateNote(
  actor: Actor,
  { id, ...input }: z.infer<typeof updateNoteInput>,
) {
  await checkRepo(actor, input.repoId);
  const [row] = await db
    .update(notes)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(editable(actor, id))
    .returning({ id: notes.id });
  if (!row) throw new Error("Note not found.");
  return row;
}

export async function deleteNote(
  actor: Actor,
  { id }: z.infer<typeof deleteNoteInput>,
) {
  const [row] = await db
    .delete(notes)
    .where(editable(actor, id))
    .returning({ id: notes.id });
  if (!row) throw new Error("Note not found.");
  return row;
}

/** The notes a session on this repository loads: pinned to all, or to it. */
export function notesForRepo(orgId: string, repoId: string) {
  return db
    .select({ title: notes.title, trigger: notes.trigger, body: notes.body })
    .from(notes)
    .where(
      and(
        eq(notes.orgId, orgId),
        or(isNull(notes.repoId), eq(notes.repoId, repoId)),
      ),
    )
    .orderBy(notes.createdAt);
}
