// Check actual login on the built, combined application using disposable fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/passwords";
const db = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const id = randomUUID();
async function main() {
  const directory = (process.env.TEST_BUILD_DIR || "artifacts/complete-backend/.next") + "/server/chunks";
  let action = "";
  for (const file of readdirSync(directory).filter(name => name.endsWith(".js"))) {
    const text = readFileSync(directory + "/" + file, "utf8");
    if (text.includes("Use upper and lower case letters")) {
      action = text.match(/\)\("([a-f0-9]{40})",[\w$]+\)/)?.[1] || "";
      if (action) break;
    }
  }
  assert.ok(action, "Could not locate built login action");
  const phone = "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const password = randomBytes(24).toString("hex") + "Aa1!";
  await db.query("insert into private.accounts(id,password_hash) values($1,$2)", [id, await hashPassword(password)]);
  await db.query("insert into public.profiles(id,full_name,phone,role,must_change_password) values($1,$2,$3,'super_admin',true)", [id, "Combined deployment test", phone]);
  const origin = "http://127.0.0.1:3102";
  const page = await fetch(origin + "/login");
  assert.equal(page.status, 200);
  assert.ok(!(await page.text()).includes("Database connection required"));
  assert.equal((await fetch(origin + "/api/health")).status, 200);
  const login = await fetch(origin + "/login", {
    method: "POST", redirect: "manual",
    headers: { Origin: origin, "Next-Action": action, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([{ phone, password }]),
  });
  assert.equal(login.status, 200);
  const result = await login.text();
  assert.ok(result.includes('"ok":true'), "Login failed: " + result.slice(0, 400));
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("techly-session="));
  assert.ok(cookie); assert.match(cookie, /httponly/i);
  const dashboard = await fetch(origin + "/", { headers: { Cookie: cookie.split(";")[0] }, redirect: "manual" });
  assert.equal(dashboard.status, 307); assert.equal(dashboard.headers.get("location"), "/change-password");
  const change = await fetch(origin + "/change-password", { headers: { Cookie: cookie.split(";")[0] } });
  assert.equal(change.status, 200);
  console.log("PASS: combined app health, login UI, database authentication, HttpOnly session and required password change.");
}
async function cleanup() {
  try {
    await db.query("delete from public.history where actor_id=$1", [id]);
    await db.query("delete from public.profiles where id=$1", [id]);
    await db.query("delete from private.accounts where id=$1", [id]);
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
