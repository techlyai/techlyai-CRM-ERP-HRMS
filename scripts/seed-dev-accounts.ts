import { readFileSync } from "node:fs";
import { normalizePhone } from "../src/lib/domain";
import { hashPassword } from "../src/lib/passwords";
import { transaction, pool } from "../src/lib/postgres";

// Creates the development accounts listed in scripts/dev-accounts.json.
// Idempotent: existing usernames are left alone (password included) unless
// --reset-passwords is passed. Seeded accounts are flagged weak_password, so
// the server refuses them in production unless ALLOW_DEV_ACCOUNTS=true.
type Account = {
  username: string;
  name: string;
  role: "super_admin" | "manager" | "employee";
  phone: string;
  department?: string;
  manager?: string;
};
const args = process.argv.slice(3);
const flag = (key: string) => args.includes("--" + key);
const option = (key: string) => {
  const i = args.indexOf("--" + key);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const production = process.env.NODE_ENV === "production";
  if (production && process.env.ALLOW_DEV_ACCOUNTS !== "true")
    throw Error("Refusing to seed development accounts in production. Set ALLOW_DEV_ACCOUNTS=true only for an isolated test deployment.");
  const password = process.env.DEV_ACCOUNT_PASSWORD || (production ? "" : "123");
  if (!password) throw Error("Set DEV_ACCOUNT_PASSWORD to seed accounts in this environment.");
  const file = option("config") || "scripts/dev-accounts.json";
  const accounts = (JSON.parse(readFileSync(file, "utf8")) as { accounts: Account[] }).accounts;
  for (const a of accounts) {
    if (!/^[a-z][a-z0-9._-]{2,39}$/.test(a.username)) throw Error(`Invalid username: ${a.username}`);
    if (!["super_admin", "manager", "employee"].includes(a.role)) throw Error(`Invalid role for ${a.username}: ${a.role}`);
    if (!a.name?.trim()) throw Error(`Missing name for ${a.username}`);
  }
  const reset = flag("reset-passwords");
  const results = await transaction(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext('techly-dev-accounts'))");
    const out: string[] = [];
    const ids = new Map<string, string>();
    for (const a of accounts) {
      const phone = normalizePhone(a.phone);
      const existing = (
        await c.query("select id from public.profiles where username=$1 or phone=$2", [a.username, phone])
      ).rows;
      if (existing.length > 1) throw Error(`${a.username}: username and phone belong to different accounts`);
      if (existing.length) {
        const id = existing[0].id as string;
        ids.set(a.username, id);
        if (reset) {
          await c.query(
            "update private.accounts set password_hash=$2,weak_password=true,password_changed_at=now() where id=$1",
            [id, await hashPassword(password)],
          );
          await c.query("update public.profiles set must_change_password=false where id=$1", [id]);
          await c.query("delete from private.sessions where user_id=$1", [id]);
          out.push(`${a.username}: password reset`);
        } else out.push(`${a.username}: already exists, unchanged`);
        continue;
      }
      const { rows } = await c.query(
        "insert into private.accounts(password_hash,weak_password,password_changed_at) values($1,true,now()) returning id",
        [await hashPassword(password)],
      );
      const id = rows[0].id as string;
      const managerId = a.manager ? ids.get(a.manager) || null : null;
      if (a.manager && !managerId) throw Error(`${a.username}: manager ${a.manager} must be listed earlier`);
      const employeeId =
        a.role === "employee"
          ? ((await c.query("select private.next_employee_id($1) as v", [a.department || null])).rows[0].v as string)
          : null;
      await c.query(
        "insert into public.profiles(id,full_name,phone,username,role,department,manager_id,employee_id,must_change_password) values($1,$2,$3,$4,$5,$6,$7,$8,false)",
        [id, a.name.trim(), phone, a.username, a.role, a.department || null, managerId, employeeId],
      );
      await c.query(
        "insert into public.history(actor_id,action,snapshot) values($1,'Development account created',$2)",
        [id, JSON.stringify({ username: a.username, role: a.role })],
      );
      ids.set(a.username, id);
      out.push(`${a.username}: created (${a.role}${employeeId ? ", " + employeeId : ""})`);
    }
    return out;
  });
  console.log(results.join("\n"));
  console.log("Development accounts use a weak shared password. Never enable them on a production deployment.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
