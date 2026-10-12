// Real HTTP integration test for the two built services; creates and removes only
// uniquely identified test fixtures. Requires owner access to a local test database.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/passwords";
const frontend = "http://127.0.0.1:3100";
const backend = "http://127.0.0.1:3101";
const owner = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
const ids = [randomUUID(), randomUUID(), randomUUID()];
const password = randomBytes(20).toString("hex") + "Aa1!";
const phones = ids.map(() => "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"));
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function actionID(name: string) {
  const directory = (process.env.TEST_FRONTEND_BUILD_DIR || "artifacts/services/frontend/.next") + "/server/chunks";
  for (const file of readdirSync(directory).filter(v => v.endsWith(".js"))) {
    const text = readFileSync(directory + "/" + file, "utf8");
    const fn = text.match(new RegExp('async function ([\\w$]+)\\([^)]*\\)\\{return [\\w$]+\\("' + escape(name) + '"'));
    if (!fn) continue;
    const id = text.match(new RegExp('"([a-f0-9]{40})",' + escape(fn[1]) + '\\)'));
    if (id) return id[1];
  }
  throw Error("Cannot locate built action: " + name);
}
async function action(name: string, args: unknown[], cookie = "") {
  const response = await fetch(frontend + "/login", {
    method: "POST", redirect: "manual",
    headers: { Origin: frontend, "Next-Action": actionID(name), "Content-Type": "text/plain;charset=UTF-8", Cookie: cookie },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { response, text };
}
async function internal(operation: string, cookie: string, data: unknown = {}) {
  return fetch(backend + "/api/internal/" + operation, {
    method: "POST", headers: { "x-techly-service-key": process.env.TECHLY_INTERNAL_API_KEY!, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(data), redirect: "manual",
  });
}
async function main() {
  assert.equal((await fetch(backend + "/api/health")).status, 200);
  assert.equal((await fetch(backend + "/api/internal/session", { method: "POST" })).status, 401);
  assert.equal((await fetch(backend + "/api/notifications", { headers: { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" } })).status, 401);
  assert.equal((await fetch(frontend + "/api/internal/session", { method: "POST" })).status, 404);
  assert.equal((await internal("session", "")).status, 401);
  const hash = await hashPassword(password);
  for (let i = 0; i < ids.length; i++) {
    await owner.query("insert into private.accounts(id,password_hash) values($1,$2)", [ids[i], hash]);
    await owner.query("insert into public.profiles(id,full_name,phone,role,must_change_password) values($1,$2,$3,$4,$5)",
      [ids[i], "Split verification " + i, phones[i], i === 0 ? "super_admin" : "employee", i === 0]);
  }
  assert.equal((await fetch(frontend + "/login")).status, 200);
  const sessions: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const login = await action("login", [{ phone: phones[i], password }]);
    assert.equal(login.response.status, 200);
    assert.ok(login.text.includes('"ok":true'), "Login failed: " + login.text.slice(0, 500));
    const setCookie = login.response.headers.getSetCookie().find(v => v.startsWith("techly-session="));
    assert.ok(setCookie, "No frontend session cookie");
    assert.match(setCookie, /httponly/i); assert.match(setCookie, /samesite=lax/i);
    sessions.push(setCookie.split(";")[0]);
  }
  const forced = await fetch(frontend + "/", { headers: { Cookie: sessions[0] }, redirect: "manual" });
  assert.equal(forced.status, 307); assert.equal(forced.headers.get("location"), "/change-password");
  assert.equal((await internal("select", sessions[0], { table: "records", query: "select=id" })).status, 403);
  const changed = await action("changePassword", [password + "new"], sessions[0]);
  assert.ok(changed.text.includes('"ok":true'), "Password forwarding failed: " + changed.text.slice(0, 400));
  for (const route of ["/", "/users", "/settings", "/modules/leads"]) {
    const page = await fetch(frontend + route, { headers: { Cookie: sessions[0] } });
    assert.equal(page.status, 200, "Failed SSR page: " + route);
  }
  const saved = await action("saveRecord", [{ module: "leads", title: "Split test " + ids[1], data: { contact: "Test", phone: phones[1] } }], sessions[1]);
  assert.ok(saved.text.includes('"ok":true'), "Save failed: " + saved.text.slice(0, 500));
  const record = (await owner.query("select id from public.records where created_by=$1", [ids[1]])).rows[0].id;
  const request = { table: "records", query: "select=id&module=eq.leads&id=eq." + record };
  const visible = await (await internal("select", sessions[1], request)).json();
  const hidden = await (await internal("select", sessions[2], request)).json();
  assert.equal(visible.result.length, 1); assert.deepEqual(hidden.result, []);
  assert.equal((await internal("rpc", sessions[1], { name: "scheduler_tick", args: {} })).status, 400);
  const denied = await action("createUser", [{ phone: phones[1], name: "Denied", role: "super_admin" }], sessions[1]);
  assert.ok(denied.text.includes('"ok":false'));
  const invalidOrigin = await fetch(frontend + "/api/uploads", { method: "POST", headers: { Origin: "https://invalid.example", Cookie: sessions[1] }, body: "{}" });
  assert.equal(invalidOrigin.status, 403);
  const file = Buffer.from("name,value\nSplit verification,1\n");
  const api = async (path: string, method: string, body: BodyInit, type = "application/json") => {
    const response = await fetch(frontend + path, { method, headers: { Cookie: sessions[1], Origin: frontend, "Content-Type": type }, body });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  const upload = await api("/api/uploads", "POST", JSON.stringify({ record, name: "verification.csv", mime: "text/csv", size: file.length }));
  await api(`/api/uploads?upload=${upload.id}&part=0`, "PUT", Uint8Array.from(file), "application/octet-stream");
  await api("/api/uploads", "PUT", JSON.stringify({ id: upload.id }));
  const attachment = (await owner.query("select id from public.attachments where record_id=$1", [record])).rows[0].id;
  const download = await fetch(frontend + "/api/files/" + attachment, { headers: { Cookie: sessions[1] } });
  assert.equal(download.status, 200); assert.equal(await download.text(), file.toString());
  const inaccessible = await fetch(frontend + "/api/files/" + attachment, { headers: { Cookie: sessions[2] } });
  assert.notEqual(inaccessible.status, 200);
  const loggedOut = await action("logout", [], sessions[1]);
  assert.ok(loggedOut.response.headers.getSetCookie().some(v => /techly-session=;/.test(v)));
  assert.equal((await internal("session", sessions[1])).status, 401);
  console.log("PASS: service-key protection, login/cookie forwarding, password change, admin SSR, record creation, cross-user RLS, RPC allowlist, origin checks, upload/download isolation, and logout.");
}
async function cleanup() {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("delete from private.uploads where user_id=any($1::uuid[])", [ids]);
    await c.query("delete from private.stored_files where uploaded_by=any($1::uuid[])", [ids]);
    await c.query("delete from public.attachments where uploaded_by=any($1::uuid[])", [ids]);
    await c.query("delete from private.push_outbox where notification_id in(select id from public.notifications where user_id=any($1::uuid[]) or record_id in(select id from public.records where created_by=any($1::uuid[])))", [ids]);
    await c.query("delete from public.notifications where user_id=any($1::uuid[]) or record_id in(select id from public.records where created_by=any($1::uuid[]))", [ids]);
    await c.query("delete from public.history where actor_id=any($1::uuid[]) or record_id in(select id from public.records where created_by=any($1::uuid[]))", [ids]);
    await c.query("delete from public.records where created_by=any($1::uuid[])", [ids]);
    await c.query("delete from public.profiles where id=any($1::uuid[])", [ids]);
    await c.query("delete from private.accounts where id=any($1::uuid[])", [ids]);
    await c.query("commit");
  } catch (error) { await c.query("rollback"); throw error; }
  finally { c.release(); await owner.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
