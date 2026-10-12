import { randomBytes } from "node:crypto";
import { normalizePhone } from "../src/lib/domain";
import { hashPassword } from "../src/lib/passwords";
import { transaction, pool } from "../src/lib/postgres";
const args = process.argv.slice(3);
const arg = (key: string) => {
  const i = args.indexOf("--" + key);
  return i >= 0 ? args[i + 1] : undefined;
};
async function main() {
  const phone = normalizePhone(arg("phone") || "");
  const name = arg("name");
  if (!name || name.length > 200)
    throw Error(
      'Usage: npm run create-admin -- --phone 9876543210 --name "Your Name"',
    );
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const hash = await hashPassword(password);
  await transaction(async (c) => {
    await c.query(
      "select pg_advisory_xact_lock(hashtext('techly-first-admin'))",
    );
    const existing = await c.query(
      "select id from public.profiles where role='super_admin'",
    );
    if (existing.rows.length && arg("additional") !== "true")
      throw Error("A Super Admin already exists. Use Users & access.");
    const { rows } = await c.query(
      "insert into private.accounts(password_hash) values($1) returning id",
      [hash],
    );
    await c.query(
      "insert into public.profiles(id,full_name,phone,role,must_change_password) values($1,$2,$3,'super_admin',true)",
      [rows[0].id, name, phone],
    );
    await c.query(
      "insert into public.history(actor_id,action) values($1,'Initial administrator created')",
      [rows[0].id],
    );
  });
  console.log(
    `Super Admin created\nPhone: ${phone}\nTemporary password: ${password}\nSign in and change this password. It is shown only once.`,
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool().end());
