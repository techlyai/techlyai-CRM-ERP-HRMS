/**
 * Role-based access control scenarios against a real database (migration 006).
 * Creates disposable users and records, asserts what the database allows, and
 * removes everything afterwards.
 *
 *   DATABASE_ADMIN_URL=postgresql://owner@host/db node scripts/run-ts.cjs scripts/verify-rbac.ts
 */
import assert from "node:assert/strict";
import { Client } from "pg";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw Error("Set DATABASE_ADMIN_URL to the database owner connection");
let c = new Client({ connectionString: url });
c.on("error", () => undefined);
const results: string[] = [];
async function reconnect() {
  // Some test servers drop a connection after an error; start a fresh one.
  await c.end().catch(() => undefined);
  c = new Client({ connectionString: url });
  c.on("error", () => undefined);
  await new Promise((r) => setTimeout(r, 300));
  await c.connect();
}
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  (await c.query(sql, p)).rows as T[];
/** Runs SQL as an application user under row level security. */
async function as<T = Record<string, unknown>>(uid: string, sql: string, p: unknown[] = []) {
  await q("begin");
  try {
    await q("select set_config('app.user_id',$1,true)", [uid]);
    await q("set local role techly_user");
    const rows = await q<T>(sql, p);
    await q("commit");
    return rows;
  } catch (e) {
    await reconnect();
    throw e;
  }
}
async function rejects(fn: () => Promise<unknown>, re: RegExp) {
  try {
    await fn();
  } catch (e) {
    await reconnect();
    assert.match(e instanceof Error ? e.message : String(e), re);
    return;
  }
  assert.fail("expected an error matching " + re);
}
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push("PASS " + name);
  } catch (e) {
    results.push("FAIL " + name + " → " + (e instanceof Error ? e.message : e));
    await reconnect();
  }
}
const users: string[] = [];
const records: string[] = [];
async function mkUser(name: string, role: string, dept: string | null, manager: string | null = null) {
  const id = (await q<{ id: string }>("insert into private.accounts(password_hash) values('scrypt:x:y') returning id"))[0].id;
  await q("insert into public.profiles(id,full_name,phone,role,department,manager_id,must_change_password) values($1,$2,$3,$4,$5,$6,false)", [
    id, name, "+9193" + Math.floor(1e7 + Math.random() * 9e7), role, dept, manager]);
  users.push(id);
  return id;
}
async function lead(owner: string, title: string) {
  const id = (await as<{ id: string }>(owner === admin ? admin : admin,
    "select public.save_record('leads',$1,$2,$3) id",
    [title, JSON.stringify({ contact: "X", phone: "+919811100000" }), owner]))[0].id;
  records.push(id);
  return id;
}
const grant = (uid: string, items: [string, string, string][], reason = "test") =>
  as<{ n: number }>(admin, "select public.save_user_permissions($1,$2,$3) n", [
    uid, JSON.stringify(items.map(([module, action, scope]) => ({ module, action, scope }))), reason]);
const sees = async (uid: string, id: string) =>
  (await as(uid, "select id from public.records where id=$1", [id])).length === 1;
let admin = "";

async function main() {
  await c.connect();
  admin = await mkUser("RBAC Super", "super_admin", "Ops");
  const mgrA = await mkUser("RBAC Admin A", "manager", "Sales");
  const mgrB = await mkUser("RBAC Admin B", "manager", "Ops");
  const emp1 = await mkUser("RBAC Emp One", "employee", "Sales", mgrA);
  const emp2 = await mkUser("RBAC Emp Two", "employee", "Ops", mgrB);
  const emp3 = await mkUser("RBAC Emp Three", "employee", "Sales", null);
  const lead1 = await lead(emp1, "RBAC lead one");
  const lead2 = await lead(emp2, "RBAC lead two");
  const lead3 = await lead(emp3, "RBAC lead three");
  try {
    await check("Super Admin has every permission", async () => {
      const rows = await as<{ scope: string }>(admin, "select scope from public.effective_permissions($1)", [admin]);
      assert.ok(rows.length > 140 && rows.every((r) => r.scope === "all"));
    });
    await check("employees inherit role defaults and nothing more", async () => {
      assert.equal(await sees(emp1, lead1), true);
      assert.equal(await sees(emp1, lead2), false);
      const clients = await as<{ scope: string }>(emp1, "select scope from public.effective_permissions($1) where module='clients' and action='view'", [emp1]);
      assert.equal(clients[0].scope, "none");
    });
    await check("Admins start without module access", async () => {
      assert.equal(await sees(mgrA, lead1), false);
    });
    await check("individual grant takes effect immediately, revoke too", async () => {
      await grant(mgrA, [["leads", "view", "team"]]);
      assert.equal(await sees(mgrA, lead1), true);
      assert.equal(await sees(mgrA, lead2), false);
      await grant(mgrA, [["leads", "view", "none"]]);
      assert.equal(await sees(mgrA, lead1), false);
    });
    await check("department scope reaches the same department only", async () => {
      await grant(mgrA, [["leads", "view", "department"]]);
      assert.equal(await sees(mgrA, lead3), true); // Sales
      assert.equal(await sees(mgrA, lead2), false); // Ops
    });
    await check("employees never see others' private HR records even if granted", async () => {
      await grant(emp1, [["employees", "view", "all"]]);
      const rows = await as(emp1, "select public.save_record('leave','x',$1,$2)", [
        JSON.stringify({ leave_type: "Casual Leave", start_date: "2026-11-02", end_date: "2026-11-02", duration: "Full Day", reason: "x" }), emp1]).catch(() => []);
      void rows;
      const other = await as<{ ok: boolean }>(emp1, "select private.permitted('employees','view',$1) ok", [emp2]);
      assert.equal(other[0].ok, false);
      await grant(emp1, [["employees", "view", "self"]]);
    });
    // Delegation: Admin A may manage team permissions and holds only some permissions.
    await grant(mgrA, [["users", "permissions", "team"], ["users", "view", "team"], ["leads", "view", "team"], ["leave", "approve", "team"]]);
    await check("Admin can grant permissions they hold to their team", async () => {
      await as(mgrA, "select public.save_user_permissions($1,$2,'')", [emp1, JSON.stringify([{ module: "leave", action: "approve", scope: "self" }])]);
      const r = await as<{ scope: string }>(admin, "select scope from public.effective_permissions($1) where module='leave' and action='approve'", [emp1]);
      assert.equal(r[0].scope, "self");
    });
    await check("Admin cannot grant wider than they hold", async () => {
      await rejects(() => as(mgrA, "select public.save_user_permissions($1,$2,'')", [emp1, JSON.stringify([{ module: "leads", action: "view", scope: "all" }])]), /only assign permissions you hold/);
    });
    await check("Admin cannot grant permissions they do not have", async () => {
      await rejects(() => as(mgrA, "select public.save_user_permissions($1,$2,'')", [emp1, JSON.stringify([{ module: "credentials", action: "reveal", scope: "self" }])]), /only assign permissions you hold/);
    });
    await check("Admin cannot change their own permissions", async () => {
      await rejects(() => as(mgrA, "select public.save_user_permissions($1,$2,'')", [mgrA, JSON.stringify([{ module: "leads", action: "view", scope: "team" }])]), /your own permissions/);
    });
    await check("Admin cannot touch users outside their reach or Super Admins", async () => {
      await rejects(() => as(mgrA, "select public.save_user_permissions($1,$2,'')", [emp2, JSON.stringify([{ module: "leads", action: "view", scope: "self" }])]), /permission to manage/);
      await rejects(() => as(mgrA, "select public.save_user_permissions($1,$2,'')", [admin, JSON.stringify([{ module: "leads", action: "view", scope: "self" }])]), /Super Admins always have full access/);
    });
    await check("employees cannot manage anyone's permissions", async () => {
      await rejects(() => as(emp1, "select public.save_user_permissions($1,$2,'')", [emp3, JSON.stringify([{ module: "leads", action: "view", scope: "all" }])]), /permission to manage/);
      await rejects(() => as(emp1, "select public.save_role_permissions('employee',$1,'all','')", [JSON.stringify([{ module: "leads", action: "view", scope: "all" }])]), /Only a Super Admin/);
    });
    await check("Admins cannot change roles or elevate anyone", async () => {
      await grant(mgrA, [["users", "edit", "team"]]);
      await rejects(() => as(mgrA, "select public.set_profile($1,'RBAC Emp One','Sales',$2,'super_admin',true)", [emp1, mgrA]), /Only a Super Admin can change roles/);
      await rejects(() => as(mgrA, "select public.set_profile($1,'RBAC Admin A','Sales',null,'super_admin',true)", [mgrA]), /Only a Super Admin can change roles/);
      await rejects(() => as(mgrA, "select public.set_profile($1,'RBAC Super','Ops',null,'super_admin',false)", [admin]), /permission denied|Super Admin account/i);
      await as(mgrA, "select public.set_profile($1,'RBAC Emp One','Sales',$2,'employee',true)", [emp1, mgrA]);
    });
    await check("legacy role-default writes stay Super Admin only", async () => {
      await rejects(() => as(mgrA, "select public.set_permission(null,'manager','leads','view','all')"), /Permission denied/);
    });
    await check("account creation follows the creator's reach", async () => {
      await grant(mgrA, [["users", "create", "team"]]);
      const placed = await q<{ r: { manager: string } }>("select public.authorize_user_creation($1,'employee','Ops',null) r", [mgrA]);
      assert.equal(placed[0].r.manager, mgrA);
      await rejects(() => q("select public.authorize_user_creation($1,'manager','Ops',null)", [mgrA]), /Only a Super Admin can create Admin/);
      await rejects(() => q("select public.authorize_user_creation($1,'employee','Ops',null)", [emp1]), /permission to create users/);
      await reconnect();
    });
    await check("reset removes overrides and returns to role defaults", async () => {
      await grant(emp3, [["leads", "view", "all"], ["clients", "view", "self"]]);
      await as(admin, "select public.reset_user_permissions($1,'test reset')", [emp3]);
      const r = await as<{ scope: string; override_scope: string | null }>(admin, "select scope,override_scope from public.effective_permissions($1) where module='leads' and action='view'", [emp3]);
      assert.equal(r[0].scope, "self");
      assert.equal(r[0].override_scope, null);
    });
    await check("permission history records before and after with the actor", async () => {
      const rows = await q<{ source: string; changes: { before: string; after: string }[]; actor_id: string }>(
        "select source,changes,actor_id from public.permission_audit where target_user=$1 order by id", [emp3]);
      assert.ok(rows.some((r) => r.source === "user" && r.changes.some((x) => x.after === "all")));
      assert.ok(rows.some((r) => r.source === "reset" && r.actor_id === admin));
    });
    await check("role default change can spare existing users", async () => {
      await as(admin, "select public.save_role_permissions('employee',$1,'new_only','test')", [JSON.stringify([{ module: "clients", action: "view", scope: "self" }])]);
      const existing = await as<{ scope: string }>(admin, "select scope from public.effective_permissions($1) where module='clients' and action='view'", [emp1]);
      assert.equal(existing[0].scope, "none");
      const fresh = await mkUser("RBAC Emp New", "employee", "Ops");
      const r = await as<{ scope: string }>(admin, "select scope from public.effective_permissions($1) where module='clients' and action='view'", [fresh]);
      assert.equal(r[0].scope, "self");
      await as(admin, "select public.save_role_permissions('employee',$1,'all','undo')", [JSON.stringify([{ module: "clients", action: "view", scope: "none" }])]);
    });
    await check("templates apply as complete access to several users", async () => {
      const t = (await as<{ id: string }>(admin, "select public.save_permission_template(null,'RBAC CRM template','',$1) id", [
        JSON.stringify([{ module: "leads", action: "view", scope: "team" }, { module: "leads", action: "create", scope: "self" }])]))[0].id;
      await as(admin, "select public.apply_permission_template($1,$2,'')", [t, [emp1, emp3]]);
      const r = await as<{ module: string; action: string; scope: string }>(admin, "select module,action,scope from public.effective_permissions($1) where scope<>'none'", [emp3]);
      assert.deepEqual(r.map((x) => `${x.module}.${x.action}:${x.scope}`).sort(), ["leads.create:self", "leads.view:team"]);
      await q("delete from public.permission_templates where id=$1", [t]);
    });
    await check("settings changes need the permission for that settings group", async () => {
      await grant(mgrB, [["settings", "company", "all"]]);
      const cur = (await q<{ data: Record<string, unknown> }>("select data from public.settings where id=1"))[0].data;
      await as(mgrB, "select public.update_settings($1)", [JSON.stringify({ ...cur, grace_minutes: 20 })]);
      await rejects(() => as(mgrB, "select public.update_settings($1)", [JSON.stringify({ ...cur, chat: { ...(cur.chat as object), admin_review: true } })]), /chat settings/);
      await q("update public.settings set data=$1 where id=1", [JSON.stringify(cur)]);
    });
    await check("chat access can be revoked", async () => {
      await grant(emp3, [["chat", "view", "none"]]);
      await rejects(() => as(emp3, "select public.start_direct_conversation($1)", [emp1]), /access to chat/);
      await as(admin, "select public.reset_user_permissions($1,'')", [emp3]);
    });
    await check("credential permissions are separate from client access", async () => {
      const client = (await as<{ id: string }>(admin, "select public.save_record('clients','RBAC client',$1,$2) id", [JSON.stringify({ contact: "C", phone: "+919822200000" }), admin]))[0].id;
      records.push(client);
      const cred = "6b3c8d2e-1111-4a5b-9c0d-123456789abc";
      await as(admin, "select public.create_credential($1,$2,$3,$4)", [cred, client, JSON.stringify({ service_name: "RBAC site", category: "Other" }),
        JSON.stringify({ ciphertext: Buffer.alloc(8).toString("base64"), iv: Buffer.alloc(12).toString("base64"), tag: Buffer.alloc(16).toString("base64"), key_id: "k" })]);
      await grant(mgrB, [["clients", "view", "all"], ["credentials", "view", "all"]]);
      const list = await as(mgrB, "select id from public.client_credentials where client_id=$1", [client]);
      assert.equal(list.length, 1);
      await rejects(() => as(mgrB, "select public.credential_secret($1,null,'reveal')", [cred]), /reveal or copy/);
      await grant(mgrB, [["credentials", "reveal", "all"]]);
      const s = await as(mgrB, "select public.credential_secret($1,null,'copy') s", [cred]);
      assert.equal(s.length, 1);
      await rejects(() => as(mgrB, "select public.update_credential($1,1,$2)", [cred, JSON.stringify({ service_name: "x", category: "Other" })]), /Credential not found/);
      await q("delete from public.credential_audit where credential_id=$1", [cred]);
      await q("delete from public.client_credentials where id=$1", [cred]);
    });
  } finally {
    await reconnect();
    await q("delete from public.permission_audit where target_user = any($1) or actor_id = any($1)", [users]);
    await q("delete from public.permission_grants where user_id = any($1) or updated_by = any($1)", [users]);
    await q("delete from private.push_outbox where notification_id in (select id from public.notifications where record_id = any($1) or user_id = any($2))", [records, users]);
    await q("delete from public.notifications where record_id = any($1) or user_id = any($2)", [records, users]);
    await q("delete from public.conversation_members where user_id = any($1)", [users]);
    await q("delete from public.conversations where created_by = any($1)", [users]);
    await q("delete from public.history where record_id = any($1) or actor_id = any($2)", [records, users]);
    await q("delete from public.email_log where record_id = any($1) or user_id = any($2)", [records, users]);
    await q("delete from public.records where id = any($1) or owner_id = any($2)", [records, users]);
    await q("update public.profiles set manager_id=null where id = any($1)", [users]);
    await q("delete from public.profiles where id = any($1)", [users]);
    await q("delete from private.accounts where id = any($1)", [users]);
    await c.end();
  }
  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => {
  console.error("SCRIPT ERROR", e);
  process.exitCode = 2;
});
