/**
 * GPS attendance and geofencing scenarios against a real database (migration 008).
 * Creates disposable users, offices and attendance rows, asserts what the database
 * allows, and removes everything afterwards.
 *
 *   DATABASE_ADMIN_URL=postgresql://owner@host/db node scripts/run-ts.cjs scripts/verify-attendance.ts
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
const offices: string[] = [];
async function mkUser(name: string, role: string, dept: string | null, manager: string | null = null) {
  const id = (await q<{ id: string }>("insert into private.accounts(password_hash) values('scrypt:x:y') returning id"))[0].id;
  await q("insert into public.profiles(id,full_name,phone,role,department,manager_id,must_change_password) values($1,$2,$3,$4,$5,$6,false)", [
    id, name, "+9194" + Math.floor(1e7 + Math.random() * 9e7), role, dept, manager]);
  users.push(id);
  return id;
}
const tag = Math.random().toString(36).slice(2, 7);
const MADURAI = { latitude: 9.9252, longitude: 78.1198 };
const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };
const BENGALURU = { latitude: 12.9716, longitude: 77.5946 };
// About 30 metres north of a point.
const near = (p: { latitude: number; longitude: number }) => [p.latitude + 0.00027, p.longitude];
type Clock = { action: "in" | "out"; at?: number[] | null; accuracy?: number | null; wfh?: boolean };
const clock = async (uid: string, { action, at = null, accuracy = 15, wfh = false }: Clock) =>
  (await as<{ id: string }>(uid, "select public.clock_attendance($1,$2,$3,$4,$5) id", [
    action, at?.[0] ?? null, at?.[1] ?? null, at ? accuracy : null, wfh]))[0].id;
const record = async (id: string) =>
  (await q<{ status: string; data: Record<string, unknown> }>("select status,data from public.records where id=$1", [id]))[0];
const saveOffice = (uid: string, data: Record<string, unknown>, id: string | null = null) =>
  as<{ id: string }>(uid, "select public.save_office_location($1,$2) id", [id, JSON.stringify(data)]).then((r) => r[0].id);
const assign = (uid: string, user: string, office: string | null, radius: number | null = null, remote = false) =>
  as(uid, "select public.set_attendance_location($1,$2,$3,$4)", [user, office, radius, remote]);
const grant = (actor: string, uid: string, items: [string, string, string][]) =>
  as(actor, "select public.save_user_permissions($1,$2,'verify attendance')", [
    uid, JSON.stringify(items.map(([module, action, scope]) => ({ module, action, scope })))]);

async function main() {
  await c.connect();
  // Earlier local runs or real data may have a default office; keep it out of these scenarios.
  const priorDefault = (await q<{ id: string }>("select id from public.office_locations where is_default"))[0]?.id;
  if (priorDefault) await q("update public.office_locations set is_default=false where id=$1", [priorDefault]);
  const sup = await mkUser("Geo Super", "super_admin", null);
  const adm = await mkUser("Geo Admin", "manager", "Ops");
  const e1 = await mkUser("Geo Emp One", "employee", "Ops", adm);
  const e2 = await mkUser("Geo Emp Two", "employee", "Sales");
  const e3 = await mkUser("Geo Emp Three", "employee", "Ops");
  let madurai = "", chennai = "", bengaluru = "";
  try {
    await check("Super Admin creates and edits office locations (audited)", async () => {
      madurai = await saveOffice(sup, { name: `Madurai ${tag}`, address: "Madurai", ...MADURAI, radius_m: 80 });
      chennai = await saveOffice(sup, { name: `Chennai ${tag}`, address: "Chennai", ...CHENNAI, radius_m: 150 });
      bengaluru = await saveOffice(sup, { name: `Bengaluru ${tag}`, address: "Bengaluru", ...BENGALURU, radius_m: 100 });
      offices.push(madurai, chennai, bengaluru);
      await saveOffice(sup, { name: `Madurai ${tag}`, address: "Madurai HQ", ...MADURAI, radius_m: 100 }, madurai);
      const o = (await q<{ radius_m: number; address: string }>("select radius_m,address from public.office_locations where id=$1", [madurai]))[0];
      assert.deepEqual(o, { radius_m: 100, address: "Madurai HQ" });
      const audit = await q<{ action: string }>("select action from public.location_audit where location_id=$1 order by id", [madurai]);
      assert.deepEqual(audit.map((a) => a.action), ["Office created", "Office updated"]);
      await rejects(() => saveOffice(sup, { name: `madurai ${tag}`, ...MADURAI, radius_m: 100 }), /already exists/);
      await rejects(() => saveOffice(sup, { name: "Bad", ...MADURAI, radius_m: 5 }), /between 10 and 50,000/);
    });
    await check("Super Admin assigns different offices to different people", async () => {
      await assign(sup, e1, madurai);
      await assign(sup, e2, chennai);
      await assign(sup, e3, bengaluru, 120);
      await assign(sup, adm, madurai);
      await assign(sup, sup, madurai);
      const rows = await q<{ user_id: string; location_id: string; radius_override_m: number | null }>(
        "select user_id,location_id,radius_override_m from public.attendance_assignments where user_id = any($1)", [[e1, e2, e3]]);
      const by = Object.fromEntries(rows.map((r) => [r.user_id, r]));
      assert.equal(by[e1].location_id, madurai);
      assert.equal(by[e2].location_id, chennai);
      assert.equal(by[e3].radius_override_m, 120);
      const audit = await q("select 1 from public.location_audit where user_id=$1 and action='Person assigned'", [e3]);
      assert.equal(audit.length, 1);
    });
    let e1Day = "";
    await check("Check-in inside the assigned geofence is verified", async () => {
      e1Day = await clock(e1, { action: "in", at: near(MADURAI), accuracy: 20 });
      const r = await record(e1Day);
      assert.equal(r.data.verified, true);
      assert.equal(r.data.location_status, "verified");
      assert.equal(r.data.location_id, madurai);
      assert.ok(Math.abs(Number(r.data.distance_m) - 30) < 3, "distance about 30 m, got " + r.data.distance_m);
      assert.equal(r.data.accuracy, 20);
      assert.equal(r.data.flagged, false);
    });
    await check("Duplicate check-in is refused", async () => {
      await rejects(() => clock(e1, { action: "in", at: near(MADURAI) }), /already checked in/);
    });
    await check("Each person is validated against their own office", async () => {
      // Inside Madurai, but Employee Two belongs to Chennai.
      await rejects(() => clock(e2, { action: "in", at: near(MADURAI) }), /outside the authorized office location \(42\d\.\d km from Chennai/);
    });
    await check("Missing or imprecise location is never verified", async () => {
      await rejects(() => clock(e2, { action: "in" }), /Location is required/);
      await rejects(() => clock(e2, { action: "in", at: near(CHENNAI), accuracy: 900 }), /too imprecise/);
      assert.equal((await q("select 1 from public.records where module='attendance' and owner_id=$1", [e2])).length, 0);
    });
    await check("Offices that allow outside check-in record them as unverified", async () => {
      await saveOffice(sup, { name: `Bengaluru ${tag}`, ...BENGALURU, radius_m: 100, require_inside: false }, bengaluru);
      const id = await clock(e3, { action: "in", at: near(MADURAI) });
      const r = await record(id);
      assert.equal(r.data.verified, false);
      assert.equal(r.data.location_status, "outside");
      assert.equal(r.data.radius_m, 120, "per-person radius override applies");
      assert.equal(r.data.flagged, true);
    });
    await check("Work from home needs the per-person allowance", async () => {
      await rejects(() => clock(e2, { action: "in", wfh: true }), /Work from home check-in is not enabled/);
      await assign(sup, e2, chennai, null, true);
      const r = await record(await clock(e2, { action: "in", wfh: true }));
      assert.equal(r.status, "Work From Home");
      assert.equal(r.data.verified, false);
    });
    await check("Check-out records location, duration, and is not duplicated", async () => {
      await clock(e1, { action: "out", at: near(CHENNAI) });
      const r = await record(e1Day);
      assert.ok(r.data.clock_out);
      assert.equal(typeof r.data.hours, "number");
      assert.equal(r.data.out_verified, false);
      assert.equal(r.data.out_location_status, "outside");
      assert.equal(r.data.verified, true, "check-in result is kept");
      await rejects(() => clock(e1, { action: "out", at: near(MADURAI) }), /already checked out/);
    });
    await check("Admin and Super Admin can check in and out by default", async () => {
      for (const u of [adm, sup]) {
        const id = await clock(u, { action: "in", at: near(MADURAI) });
        await clock(u, { action: "out", at: near(MADURAI) });
        const r = await record(id);
        assert.equal(r.data.verified, true);
        assert.equal(r.data.out_verified, true);
      }
    });
    await check("A missing check-out stays open and is not closed by today's check-out", async () => {
      const yesterday = (await q<{ d: string }>("select ((now() at time zone (select data->>'timezone' from public.settings where id=1))::date-1)::text d"))[0].d;
      await q("insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · '||$2,'Present',$1,$1,$3)", [
        e3, yesterday, JSON.stringify({ date: yesterday, clock_in: new Date(Date.now() - 864e5).toISOString() })]);
      const rows = await as<{ o: { user_id: string; record: { data: Record<string, unknown> } | null }[] }>(sup, "select public.attendance_overview($1::date) o", [yesterday]);
      const mine = rows[0].o.find((r) => r.user_id === e3)!;
      assert.ok(mine.record && mine.record.data.clock_in && !mine.record.data.clock_out);
      // Today's check-out closes today's session only; yesterday's open row is untouched.
      await clock(e3, { action: "out", at: near(BENGALURU) });
      const y = await q<{ data: Record<string, unknown> }>("select data from public.records where module='attendance' and owner_id=$1 and data->>'date'=$2", [e3, yesterday]);
      assert.equal(y[0].data.clock_out, undefined);
    });
    await check("Employees cannot change their office or geofences", async () => {
      await rejects(() => assign(e1, e1, chennai), /permission to change attendance locations/);
      await rejects(() => saveOffice(e1, { name: `Madurai ${tag}`, ...MADURAI, radius_m: 5000 }, madurai), /Only a Super Admin/);
      await rejects(() => as(e1, "update public.office_locations set radius_m=50000 where id=$1", [madurai]), /permission denied/);
      await rejects(() => as(e1, "update public.attendance_assignments set radius_override_m=50000 where user_id=$1", [e1]), /permission denied/);
    });
    await check("Employees cannot edit stored attendance times or coordinates", async () => {
      await rejects(() => as(e1, "update public.records set data=data||'{\"lat\":1}' where id=$1", [e1Day]), /permission denied/);
      await rejects(() => as(e1, "select public.save_record('attendance','x','{}'::jsonb,$1)", [e1]), /attendance clock actions|Invalid/);
    });
    await check("Admins cannot change geofences without an explicit grant", async () => {
      await rejects(() => assign(adm, e1, chennai), /permission to change attendance locations/);
      await rejects(() => saveOffice(adm, { name: `Madurai ${tag}`, ...MADURAI, radius_m: 5000 }, madurai), /Only a Super Admin/);
      // Viewing attendance and locations does not allow changing them.
      await grant(sup, adm, [["attendance", "view", "all"], ["locations", "view", "all"]]);
      await rejects(() => assign(adm, e1, chennai), /permission to change attendance locations/);
      await rejects(() => saveOffice(adm, { name: `Madurai ${tag}`, ...MADURAI, radius_m: 5000 }, madurai), /Only a Super Admin/);
    });
    await check("A narrow assign grant only reaches the Admin's team", async () => {
      await grant(sup, adm, [["locations", "assign", "team"]]);
      await assign(adm, e1, chennai);
      await rejects(() => assign(adm, e2, madurai), /permission to change attendance locations/);
      await rejects(() => assign(adm, adm, chennai), /permission to change attendance locations|your own/);
      await rejects(() => assign(adm, sup, chennai), /permission to change attendance locations|Super Admin/);
      await rejects(() => saveOffice(adm, { name: `Madurai ${tag}`, ...MADURAI, radius_m: 5000 }, madurai), /Only a Super Admin/);
      await assign(sup, e1, madurai);
    });
    await check("Employees see only their own attendance and office", async () => {
      const o = await as<{ o: { user_id: string }[] }>(e1, "select public.attendance_overview(current_date) o");
      assert.deepEqual(o[0].o.map((r) => r.user_id), [e1]);
      const others = await as(e1, "select id from public.records where module='attendance' and owner_id<>$1", [e1]);
      assert.equal(others.length, 0);
      const seen = await as<{ id: string }>(e1, "select id from public.office_locations where id = any($1)", [offices]);
      assert.deepEqual(seen.map((r) => r.id), [madurai]);
      assert.equal((await as(e1, "select id from public.location_audit")).length, 0);
      assert.equal((await as(e1, "select user_id from public.attendance_assignments")).length, 1);
    });
    await check("Admins see only the people their attendance scope reaches", async () => {
      await grant(sup, adm, [["attendance", "view", "team"]]);
      const o = await as<{ o: { user_id: string }[] }>(adm, "select public.attendance_overview(current_date) o");
      assert.deepEqual(o[0].o.map((r) => r.user_id).sort(), [adm, e1].sort());
    });
    await check("my_attendance_location reports the office and a server-side check", async () => {
      const r = await as<{ r: { office: { name: string }; check: { status: string; distance_m: number } } }>(
        e1, "select public.my_attendance_location($1,$2,$3) r", [...near(MADURAI), 10]);
      assert.equal(r[0].r.office.name, `Madurai ${tag}`);
      assert.equal(r[0].r.check.status, "verified");
    });
    await check("Approved corrections keep the original times", async () => {
      const corr = (await as<{ id: string }>(e1, "select public.save_record('corrections','Fix check-out',$1,$2) id", [
        JSON.stringify({ attendance_id: e1Day, clock_in: (await record(e1Day)).data.clock_in, clock_out: new Date().toISOString(), reason: "Left late" }), e1]))[0].id;
      await as(e1, "select public.workflow($1,'submit',1,'')", [corr]);
      await rejects(() => as(e1, "select public.workflow($1,'approve',2,'')", [corr]), /independent authorized reviewer/);
      await as(sup, "select public.workflow($1,'approve',2,'')", [corr]);
      const r = await record(e1Day);
      assert.equal(r.data.correction_id, corr);
      assert.ok(r.data.original && (r.data.original as Record<string, unknown>).clock_out, "original kept");
    });
    await check("Deactivated offices fall back to the default office", async () => {
      await saveOffice(sup, { name: `Chennai ${tag}`, ...CHENNAI, radius_m: 150, active: false }, chennai);
      await saveOffice(sup, { name: `Bengaluru ${tag}`, ...BENGALURU, radius_m: 100, require_inside: false, is_default: true }, bengaluru);
      const r = await as<{ r: { office: { name: string; source: string } } }>(e2, "select public.my_attendance_location() r");
      assert.equal(r[0].r.office.name, `Bengaluru ${tag}`);
      assert.equal(r[0].r.office.source, "default");
      await rejects(() => saveOffice(sup, { name: `Bengaluru ${tag}`, ...BENGALURU, radius_m: 100, is_default: true, active: false }, bengaluru), /default office must be active/);
      await saveOffice(sup, { name: `Bengaluru ${tag}`, ...BENGALURU, radius_m: 100, is_default: false }, bengaluru);
    });
    await check("Company settings can no longer change geofences", async () => {
      await rejects(() => as(sup, "select public.update_settings((select data||'{\"geofence_radius\":999}' from public.settings where id=1))"), /managed in Settings/);
    });
    await check("Old coordinates are purged after the retention period", async () => {
      const id = (await q<{ id: string }>("insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · old','Present',$1,$1,$2) returning id", [
        e2, JSON.stringify({ date: "2020-01-02", clock_in: "2020-01-02T04:00:00Z", lat: 1, lng: 2, distance_m: 5, verified: true })]))[0].id;
      await q("select public.purge_attendance_locations()");
      const r = await record(id);
      assert.equal(r.data.lat, undefined);
      assert.equal(r.data.verified, true);
      assert.ok(r.data.location_purged_at);
    });
  } finally {
    await reconnect();
    await q("delete from public.permission_audit where target_user = any($1) or actor_id = any($1)", [users]);
    await q("delete from public.permission_grants where user_id = any($1) or updated_by = any($1)", [users]);
    await q("delete from private.push_outbox where notification_id in (select id from public.notifications where user_id = any($1) or record_id in (select id from public.records where owner_id = any($1)))", [users]);
    await q("delete from public.notifications where user_id = any($1) or record_id in (select id from public.records where owner_id = any($1))", [users]);
    await q("delete from public.history where actor_id = any($1) or record_id in (select id from public.records where owner_id = any($1))", [users]);
    await q("delete from public.email_log where user_id = any($1) or record_id in (select id from public.records where owner_id = any($1))", [users]);
    await q("delete from public.records where owner_id = any($1)", [users]);
    await q("delete from public.attendance_assignments where user_id = any($1)", [users]);
    await q("delete from public.location_audit where location_id = any($1) or user_id = any($2) or actor_id = any($2)", [offices, users]);
    await q("delete from public.office_locations where id = any($1)", [offices]);
    if (priorDefault) await q("update public.office_locations set is_default=true where id=$1", [priorDefault]);
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
