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
export async function authenticate(phone: string, password: string) {
  const account = await transaction(
    async (c) =>
      (
        await c.query(
          "select a.id,a.password_hash,p.active from private.accounts a join public.profiles p on p.id=a.id where p.phone=$1",
          [phone],
        )
      ).rows[0],
  );
  const valid = await verifyPassword(
    password,
    account?.password_hash || (await dummyHash),
  );
  if (!valid || !account?.active)
    throw Error("Incorrect phone number or password.");
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
    await c.query("update private.accounts set password_hash=$1 where id=$2", [
      hash,
      profile.id,
    ]);
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
    if (!actor || actor.must_change_password || actor.role !== "super_admin")
      throw Error("Permission denied");
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
