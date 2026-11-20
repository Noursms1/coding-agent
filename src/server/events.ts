import { sql } from "drizzle-orm";
import { db } from "@/db";

interface NewEvent {
  kind: string;
  body: string;
  authorId?: string | null;
  data?: unknown;
}

/** Appends to a session's timeline; the sequence is assigned in the same statement. */
export async function appendEvent(sessionId: string, event: NewEvent) {
  await db.run(sql`
    insert into session_events (id, session_id, seq, kind, author_id, body, data)
    values (
      ${crypto.randomUUID()}, ${sessionId},
      (select coalesce(max(seq), 0) + 1 from session_events where session_id = ${sessionId}),
      ${event.kind}, ${event.authorId ?? null}, ${event.body},
      ${event.data === undefined ? null : JSON.stringify(event.data)}
    )`);
}
