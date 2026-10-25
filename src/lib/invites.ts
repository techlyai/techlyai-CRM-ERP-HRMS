import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "./postgres";
import { hashPassword, tokenHash } from "./passwords";
import { SESSION_SECONDS } from "./auth";
import { queueEmail } from "./email";

/**
 * Account activation invites. A raw token travels only inside the activation
 * link; the database keeps its SHA-256 (private.invites.token_hash), so a leaked
 * table cannot be turned into working links.
 */
export const INVITE_HOURS = 72;
const MAX_INVITE_HOURS = 24 * 30;

export const validInviteToken = (token: string) => /^[a-f0-9]{64}$/.test(token);

export function appUrl() {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
export function activationUrl(token: string) {
  return `${appUrl()}/activate?token=${encodeURIComponent(token)}`;
}

/**
 * Creates an invite inside an open service-role transaction and returns the
 * raw token. Earlier unused invites for the same user are voided so only the
 * latest link works; stale rows are pruned at the same time.
 */
export async function createInviteWith(
  client: PoolClient,
  userId: string,
  ttlHours = INVITE_HOURS,
) {
  const hours = Math.min(MAX_INVITE_HOURS, Math.max(1, Math.floor(ttlHours)));
  const token = randomBytes(32).toString("hex");
  await client.query(
    "delete from private.invites where (user_id=$1 and used_at is null) or expires_at<now()-interval '30 days'",
    [userId],
  );
  await client.query(
    "insert into private.invites(token_hash,user_id,expires_at) values($1,$2,now()+make_interval(hours=>$3::int))",
    [tokenHash(token), userId, hours],
  );
  return token;
}
export const createInvite = (userId: string, ttlHours = INVITE_HOURS) =>
  transaction((c) => createInviteWith(c, userId, ttlHours));

export type InviteState = "valid" | "invalid" | "expired" | "used" | "inactive";
export const inviteMessages: Record<Exclude<InviteState, "valid">, string> = {
  invalid:
    "This activation link is not valid. Ask your administrator to send a new invite.",
  expired:
    "This activation link has expired. Ask your administrator to send a new invite.",
  used: "This activation link has already been used. Sign in with your password, or ask your administrator for a new invite.",
  inactive: "This account is inactive. Contact your administrator.",
};

/** Checks a link before the person types a password, so the page can explain early. */
export async function inviteStatus(
  token: string,
): Promise<{ state: InviteState; name?: string }> {
  if (!validInviteToken(token)) return { state: "invalid" };
  return transaction(async (c) => {
    const row = (
      await c.query(
        "select i.used_at,i.expires_at<=now() as expired,p.full_name,p.active from private.invites i join public.profiles p on p.id=i.user_id where i.token_hash=$1",
        [tokenHash(token)],
      )
    ).rows[0];
    if (!row) return { state: "invalid" };
    const name = row.full_name as string;
    if (row.used_at) return { state: "used", name };
    if (row.expired) return { state: "expired", name };
    if (!row.active) return { state: "inactive", name };
    return { state: "valid", name };
  });
}

/**
 * Activates an account in one transaction: validates the invite, stores the new
 * password, clears the forced password change, marks the invite used, revokes
 * every existing session and opens a fresh one so the person lands signed in.
 */
export async function consumeInvite(token: string, newPassword: string) {
  if (!validInviteToken(token)) throw Error(inviteMessages.invalid);
  const hash = await hashPassword(newPassword);
  const session = randomBytes(32).toString("hex");
  return transaction(async (c) => {
    const row = (
      await c.query(
        "select i.user_id,i.used_at,i.expires_at<=now() as expired,p.active,p.full_name from private.invites i join public.profiles p on p.id=i.user_id where i.token_hash=$1 for update of i",
        [tokenHash(token)],
      )
    ).rows[0];
    if (!row) throw Error(inviteMessages.invalid);
    if (row.used_at) throw Error(inviteMessages.used);
    if (row.expired) throw Error(inviteMessages.expired);
    if (!row.active) throw Error(inviteMessages.inactive);
    const userId = row.user_id as string;
    await c.query("update private.accounts set password_hash=$1,weak_password=false,password_changed_at=now() where id=$2", [
      hash,
      userId,
    ]);
    await c.query(
      "update public.profiles set must_change_password=false where id=$1",
      [userId],
    );
    await c.query("update private.invites set used_at=now() where token_hash=$1", [
      tokenHash(token),
    ]);
    await c.query("delete from private.sessions where user_id=$1", [userId]);
    await c.query(
      "insert into private.sessions(token_hash,user_id,expires_at) values($1,$2,now()+make_interval(secs=>$3::int))",
      [tokenHash(session), userId, SESSION_SECONDS],
    );
    await c.query(
      "insert into public.history(actor_id,action,snapshot) values($1,'Account activated',$2)",
      [userId, JSON.stringify({ user_id: userId })],
    );
    return { userId, token: session, name: row.full_name as string };
  });
}

/**
 * Creates a fresh invite and queues the "welcome" email with the activation
 * link. The temporary password is never part of the message. Returns whether a
 * row was queued and, if not, why (event disabled, no address, and so on).
 */
export async function sendWelcomeInvite(
  userId: string,
  ttlHours = INVITE_HOURS,
): Promise<{ queued: boolean; recipient: string; reason?: string }> {
  const hours = Math.min(MAX_INVITE_HOURS, Math.max(1, Math.floor(ttlHours)));
  return transaction(async (c) => {
    const p = (
      await c.query(
        "select full_name,email,employee_id,active from public.profiles where id=$1",
        [userId],
      )
    ).rows[0] as
      | { full_name: string; email: string | null; employee_id: string | null; active: boolean }
      | undefined;
    if (!p) throw Error("User not found");
    if (!p.active)
      throw Error("This account is inactive. Reactivate it before sending an invite.");
    if (!p.email)
      throw Error("Add an email address to this user before sending an invite.");
    const settings = (await c.query("select data from public.email_settings where id=1"))
      .rows[0]?.data as { support_contact?: string } | undefined;
    const token = await createInviteWith(c, userId, hours);
    const body = [
      "Hi {{name}},",
      "Your {{company}} workspace account is ready. Set your password to activate it:\n{{link}}",
      `This link works for ${hours} hours and can be used once.`,
      p.employee_id ? "Your employee ID is {{employee_id}}." : "",
      "After activating, sign in at {{login}} with your phone number and the password you choose.",
      settings?.support_contact?.trim()
        ? "Need help? Contact {{support}}."
        : "Need help? Contact your administrator.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const result = await queueEmail(c, {
      event: "welcome",
      userId,
      subject: "Welcome to {{company}}",
      body,
      vars: {
        link: activationUrl(token),
        employee_id: p.employee_id || "",
        recipient: p.email,
        login: `${appUrl()}/login`,
        hours: String(hours),
      },
      key: `welcome:${userId}:${Date.now()}`,
    });
    return result.queued
      ? { queued: true, recipient: result.recipient }
      : { queued: false, recipient: p.email, reason: result.reason };
  });
}
