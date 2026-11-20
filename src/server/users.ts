import { isAdmin, type EveryAppUser } from "@every-app/sdk/server";
import { db } from "@/db";
import { users } from "@/db/schema";

/** Who is acting, as the queries need it. */
export interface Actor {
  id: string;
  orgId: string;
  email: string;
  admin: boolean;
}

/** Records the member on first sight (email from the identity) and returns the actor. */
export async function actorFor(user: EveryAppUser): Promise<Actor> {
  await db
    .insert(users)
    .values({ id: user.id, orgId: user.orgId, email: user.email })
    .onConflictDoUpdate({ target: users.id, set: { email: user.email } });
  return {
    id: user.id,
    orgId: user.orgId,
    email: user.email,
    admin: isAdmin(user),
  };
}
