import { randomBytes } from "node:crypto";
import { transaction } from "./postgres";
import { hashPassword, verifyPassword, tokenHash } from "./passwords";
import type { Profile } from "./modules";
import type { PoolClient } from "pg";
export const SESSION_SECONDS = 60 * 60 * 12;
const dummyHash = hashPassword(randomBytes(32).toString("hex"));

export async function sessionProfile(
  client: PoolClient,
  token: string,
): Promise<Profile | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await client.query<Profile>(
    "select p.* from private.sessions s join public.profiles p on p.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and p.active",
    [tokenHash(token)],
  );
  return rows[0] || null;
}
/**
 * Development accounts (seeded with a known weak password) may sign in only
 * outside production, or when ALLOW_DEV_ACCOUNTS=true is set deliberately for
 * an isolated test deployment.
 */
export function devAccountsAllowed() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ALLOW_DEV_ACCOUNTS === "true"
  );
}
/** Signs in with a phone number or a username. */
export async function authenticate(
  login: { phone: string } | { username: string },
  password: string,
) {
  const account = await transaction(
    async (c) =>
      (
        await c.query(
          "phone" in login
            ? "select a.id,a.password_hash,a.weak_password,p.active from private.accounts a join public.profiles p on p.id=a.id where p.phone=$1"
            : "select a.id,a.password_hash,a.weak_password,p.active from private.accounts a join public.profiles p on p.id=a.id where p.username=$1",
          ["phone" in login ? login.phone : login.username],
        )
      ).rows[0],
  );
  const valid = await verifyPassword(
    password,
    account?.password_hash || (await dummyHash),
  );
  if (!valid || !account?.active)
    throw Error("Incorrect username, phone number or password.");
  if (account.weak_password && !devAccountsAllowed())
    throw Error(
      "This development account is disabled in production. Ask an administrator to set a secure password.",
    );
  const token = randomBytes(32).toString("hex");
  await transaction(async (c) => {
    // Recheck while locking the account so password resets cannot race session creation.
    const latest = (
      await c.query(
        "select password_hash from private.accounts where id=$1 for update",
        [account.id],
      )
    ).rows[0];
    if (latest?.password_hash !== account.password_hash)
      throw Error("Please sign in again.");
    await c.query("delete from private.sessions where expires_at<=now()");
    await c.query(
      "insert into private.sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '12 hours')",
      [tokenHash(token), account.id],
    );
  });
  return { token, userId: account.id as string };
}
export async function revokeSession(token: string) {
  await transaction(async (c) => {
    await c.query("delete from private.sessions where token_hash=$1", [
      tokenHash(token),
    ]);
  });
}
export async function replacePassword(token: string, password: string) {
  const hash = await hashPassword(password);
  await transaction(async (c) => {
    const profile = await sessionProfile(c, token);
    if (!profile) throw Error("Please sign in again.");
    await c.query(
      "update private.accounts set password_hash=$1,weak_password=false,password_changed_at=now() where id=$2",
      [hash, profile.id],
    );
    await c.query(
      "update public.profiles set must_change_password=false where id=$1",
      [profile.id],
    );
    await c.query(
      "delete from private.sessions where user_id=$1 and token_hash<>$2",
      [profile.id, tokenHash(token)],
    );
    await c.query(
      "insert into public.history(actor_id,action) values($1,'Password changed')",
      [profile.id],
    );
  });
}
/**
 * Administrator password reset: the database authorizes the actor for this
 * user, then a random temporary password replaces the old one. The user must
 * choose their own password at next sign-in, and existing sessions end.
 */
export async function resetPasswordByAdmin(actorToken: string, userId: string) {
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const hash = await hashPassword(password);
  await transaction(async (c) => {
    const actor = await sessionProfile(c, actorToken);
    if (!actor || actor.must_change_password) throw Error("Please sign in again.");
    await c.query("select public.authorize_password_reset($1,$2)", [actor.id, userId]);
    await c.query(
      "update private.accounts set password_hash=$1,weak_password=false,password_changed_at=now() where id=$2",
      [hash, userId],
    );
    await c.query("update public.profiles set must_change_password=true where id=$1", [userId]);
    await c.query("delete from private.sessions where user_id=$1", [userId]);
    await c.query(
      "insert into public.history(actor_id,action,snapshot) values($1,'Password reset by administrator',$2)",
      [actor.id, JSON.stringify({ user_id: userId })],
    );
  });
  return password;
}
export async function provisionUser(
  actorToken: string,
  input: {
    phone: string;
    name: string;
    role: string;
    department?: string;
    manager?: string;
  },
  password: string,
) {
  const hash = await hashPassword(password);
  return transaction(async (c) => {
    const actor = await sessionProfile(c, actorToken);
    if (!actor || actor.must_change_password) throw Error("Permission denied");
    // The database decides who may create which accounts and where they are placed:
    // only Super Admins create Admins; Admins with Create users add Employees within their reach.
    const placement = (
      await c.query(
        "select public.authorize_user_creation($1,$2,$3,$4) as p",
        [actor.id, input.role, input.department || null, input.manager || null],
      )
    ).rows[0].p as { department: string | null; manager: string | null };
    input = {
      ...input,
      department: placement.department || undefined,
      manager: placement.manager || undefined,
    };
    const { rows } = await c.query(
      "insert into private.accounts(password_hash) values($1) returning id",
      [hash],
    );
    const id = rows[0].id as string;
    await c.query(
      "insert into public.profiles(id,phone,full_name,role,department,manager_id) values($1,$2,$3,$4,$5,$6)",
      [
        id,
        input.phone,
        input.name,
        input.role,
        input.department || null,
        input.manager || null,
      ],
    );
    await c.query(
      "insert into public.history(actor_id,action,snapshot) values($1,'User created',$2)",
      [actor.id, JSON.stringify({ id, phone: input.phone, role: input.role })],
    );
    return id;
  });
}
