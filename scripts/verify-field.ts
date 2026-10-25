/**
 * Field operations scenarios against a real database (migration 009): assignments,
 * tracked sessions, visits, GPS photo verification, report review and access rules.
 * Creates disposable users and removes everything afterwards.
 *
 *   DATABASE_ADMIN_URL=postgresql://owner@host/db node scripts/run-ts.cjs scripts/verify-field.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw Error("Set DATABASE_ADMIN_URL to the database owner connection");
let c = new Client({ connectionString: url });
c.on("error", () => undefined);
const results: string[] = [];
async function reconnect() {
  await c.end().catch(() => undefined);
  c = new Client({ connectionString: url });
  c.on("error", () => undefined);
  await new Promise((r) => setTimeout(r, 300));
  await c.connect();
}
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];
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
  if (process.env.VERBOSE) console.log("…", name);
  try {
    await fn();
    results.push("PASS " + name);
  } catch (e) {
    results.push("FAIL " + name + " → " + (e instanceof Error ? e.message : e));
    await reconnect();
  }
}
const users: string[] = [];
const sites: string[] = [];
async function mkUser(name: string, role: string, dept: string | null, manager: string | null = null) {
  const id = (await q<{ id: string }>("insert into private.accounts(password_hash) values('scrypt:x:y') returning id"))[0].id;
  await q("insert into public.profiles(id,full_name,phone,role,department,manager_id,must_change_password) values($1,$2,$3,$4,$5,$6,false)", [
    id, name, "+9195" + Math.floor(1e7 + Math.random() * 9e7), role, dept, manager]);
  users.push(id);
  return id;
}
const tag = Math.random().toString(36).slice(2, 7);
const SITE = { latitude: 12.9716, longitude: 77.5946 };
const near = (m = 30) => [SITE.latitude + m / 111320, SITE.longitude];
const grant = (actor: string, uid: string, items: [string, string, string][]) =>
  as(actor, "select public.save_user_permissions($1,$2,'verify field')", [uid, JSON.stringify(items.map(([module, action, scope]) => ({ module, action, scope })))]);
const assignment = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ enabled: true, schedule_days: [0, 1, 2, 3, 4, 5, 6], schedule_start: "00:00", schedule_end: "23:59", interval_seconds: 120, photo_upload: true, gallery_allowed: false, geofence_required: true, default_radius_m: 150, ...over });
async function checkIn(uid: string) {
  const d = (await q<{ d: string }>("select (now() at time zone (select data->>'timezone' from public.settings where id=1))::date::text d"))[0].d;
  await q("delete from public.history where record_id in (select id from public.records where module='attendance' and owner_id=$1 and data->>'date'=$2)", [uid, d]);
  await q("update public.field_sessions set attendance_id=null where attendance_id in (select id from public.records where module='attendance' and owner_id=$1 and data->>'date'=$2)", [uid, d]);
  await q("delete from public.records where module='attendance' and owner_id=$1 and data->>'date'=$2", [uid, d]);
  return (await q<{ id: string }>("insert into public.records(module,title,status,owner_id,created_by,data) values('attendance','Attendance · '||$2,'Present',$1,$1,$3) returning id", [
    uid, d, JSON.stringify({ date: d, clock_in: new Date().toISOString() })]))[0].id;
}
const photo = (uid: string, session: string, over: Record<string, unknown> = {}) =>
  as<{ p: Record<string, unknown> }>(uid, "select public.field_create_photo($1) p", [JSON.stringify({
    client_key: randomUUID(), session_id: session, source: "camera", lat: near()[0], lng: near()[1], accuracy: 15,
    captured_at: new Date().toISOString(), file_name: "site.jpg", mime: "image/jpeg", size: 1000, title: "Panel", ...over })]).then((r) => r[0].p);
const point = (over: Record<string, unknown> = {}) => ({ client_id: randomUUID(), lat: near(10)[0], lng: near(10)[1], accuracy: 12, captured_at: new Date().toISOString(), source: "track", ...over });
const notes = async (uid: string) => (await q<{ title: string }>("select title from public.notifications where user_id=$1 and category='field' order by created_at", [uid])).map((n) => n.title);

async function main() {
  await c.connect();
  const sup = await mkUser("Field Super", "super_admin", null);
  const admA = await mkUser("Field Admin A", "manager", "Ops");
  const admB = await mkUser("Field Admin B", "manager", "Sales");
  const tl = await mkUser("Field TL", "employee", "Ops");
  const f1 = await mkUser("Field Emp One", "employee", "Ops");
  const f2 = await mkUser("Field Emp Two", "employee", "Sales");
  const office = await mkUser("Office Emp", "employee", "Ops");
  const other = await mkUser("Other Emp", "employee", "Ops");
  let site = "", s1 = "", inside = "", report = "", visit = "";
  try {
    await check("Super Admin creates a site and assigns field employees (audited)", async () => {
      site = (await as<{ id: string }>(sup, "select public.field_save_site(null,$1) id", [JSON.stringify({ name: `Site ${tag}`, customer: "Acme", ...SITE, radius_m: 100 })]))[0].id;
      sites.push(site);
      await as(sup, "select public.field_save_assignment($1,$2)", [f1, assignment({ team_leader_id: tl, reporting_admin_id: admA, site_ids: [site] })]);
      await as(sup, "select public.field_save_assignment($1,$2)", [f2, assignment({ reporting_admin_id: admB })]);
      const audit = await q("select action from public.field_audit where user_id = any($1)", [[f1, f2]]);
      assert.equal(audit.length, 2);
      await rejects(() => as(admA, "select public.field_save_assignment($1,$2)", [office, assignment()]), /Only a Super Admin/);
      await rejects(() => as(sup, "select public.field_save_assignment($1,$2)", [f1, assignment({ reporting_admin_id: other })]), /Reporting Admin must be/);
    });
    await check("Only designated employees can start field sessions, after checking in", async () => {
      await checkIn(office);
      await rejects(() => as(office, "select public.field_start_session()"), /not enabled/);
      await rejects(() => as(f1, "select public.field_start_session()"), /Check in for attendance/);
      await checkIn(f1);
      s1 = (await as<{ id: string }>(f1, "select public.field_start_session($1,$2,$3) id", [...near(), 20]))[0].id;
      await rejects(() => as(f1, "select public.field_start_session()"), /already running/);
      const s = (await q<{ point_count: number; window_end: string }>("select point_count,window_end from public.field_sessions where id=$1", [s1]))[0];
      assert.equal(s.point_count, 1);
    });
    await check("Points are stored with time and accuracy, deduplicated and throttled", async () => {
      const t0 = Date.now();
      const a = point({ captured_at: new Date(t0 - 10 * 60e3 < 0 ? t0 : t0 - 1000).toISOString() });
      const b = point({ captured_at: new Date(t0 + 1000).toISOString() }); // too close to a → throttled
      const future = point({ captured_at: new Date(t0 + 10 * 60e3).toISOString() });
      const bad = { ...point(), accuracy: -5 };
      const r = (await as<{ r: { accepted: number; skipped: number } }>(f1, "select public.field_record_points($1,$2) r", [s1, JSON.stringify([a, b, future, bad])]))[0].r;
      assert.deepEqual(r, { ...r, accepted: 1, skipped: 3 });
      const again = (await as<{ r: { accepted: number } }>(f1, "select public.field_record_points($1,$2) r", [s1, JSON.stringify([a])]))[0].r;
      assert.equal(again.accepted, 0);
      const rows = await q<{ accuracy_m: number; captured_at: string }>("select accuracy_m,captured_at from public.field_points where session_id=$1 and source='track'", [s1]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].accuracy_m, 12);
      await rejects(() => as(other, "select public.field_record_points($1,$2)", [s1, JSON.stringify([point()])]), /not found/);
    });
    await check("Visits are verified against the assigned site", async () => {
      visit = (await as<{ id: string }>(f1, "select public.field_start_visit($1,$2,$3,$4,$5) id", [s1, JSON.stringify({ title: "Install", site_id: site, purpose: "Install panel" }), ...near(40), 10]))[0].id;
      await rejects(() => as(f1, "select public.field_start_visit($1,$2)", [s1, JSON.stringify({ title: "Second" })]), /End your current visit/);
      await as(f1, "select public.field_end_visit($1,$2,$3,$4)", [visit, ...near(500), 10]);
      const v = (await q<{ start_status: string; end_status: string; customer: string }>("select start_status,end_status,customer from public.field_visits where id=$1", [visit]))[0];
      assert.deepEqual(v, { start_status: "verified", end_status: "outside", customer: "Acme" });
    });
    await check("GPS photos are checked against the expected geofence", async () => {
      const ok = await photo(f1, s1, { visit_id: visit });
      inside = String(ok.id);
      assert.equal(ok.verification, "verified");
      assert.equal(ok.session_id, s1);
      assert.equal(ok.user_id, f1);
      assert.equal(ok.expected_label, `Site ${tag}`);
      assert.equal((await photo(f1, s1, { lat: near(900)[0] })).verification, "outside");
      assert.equal((await photo(f1, s1, { lat: null, lng: null })).verification, "gps_unavailable");
      assert.equal((await photo(f1, s1, { accuracy: 800 })).verification, "inaccurate");
      const skew = await photo(f1, s1, { captured_at: new Date(Date.now() - 3 * 3600e3).toISOString() });
      assert.equal(skew.verification, "manual_review");
      // Retrying with the same key returns the same photo.
      const key = randomUUID();
      const first = await photo(f1, s1, { client_key: key });
      const retry = await photo(f1, s1, { client_key: key, lat: 0, lng: 0 });
      assert.equal(retry.id, first.id);
      assert.equal(retry.verification, "verified");
    });
    await check("Gallery images follow policy and are never auto-verified", async () => {
      await rejects(() => photo(f1, s1, { source: "gallery" }), /requires taking photos with the camera/);
      await as(sup, "select public.field_save_assignment($1,$2)", [f1, assignment({ team_leader_id: tl, reporting_admin_id: admA, site_ids: [site], gallery_allowed: true })]);
      const g = await photo(f1, s1, { source: "gallery" });
      assert.equal(g.verification, "manual_review");
      assert.equal((g.checks as Record<string, unknown>).gallery_image, true);
    });
    await check("Photo uploads are tied to the owner's own photo", async () => {
      const own = await as<{ ok: boolean }>(f1, "select public.field_upload_allowed('field_photo',$1,'image/jpeg',1000) ok", [inside]);
      assert.equal(own[0].ok, true);
      const wrongSize = await as<{ ok: boolean }>(f1, "select public.field_upload_allowed('field_photo',$1,'image/jpeg',999) ok", [inside]);
      assert.equal(wrongSize[0].ok, false);
      const theirs = await as<{ ok: boolean }>(other, "select public.field_upload_allowed('field_photo',$1,'image/jpeg',1000) ok", [inside]);
      assert.equal(theirs[0].ok, false);
    });
    await check("Team Leaders see only assigned people, and only with the permission", async () => {
      assert.equal((await as(tl, "select id from public.field_photos")).length, 0, "no permission yet");
      await grant(sup, tl, [["field", "view", "self"], ["field", "review", "self"]]);
      const users = (await as<{ o: { user_id: string }[] }>(tl, "select public.field_overview(current_date) o"))[0].o.map((r) => r.user_id);
      assert.deepEqual(users, [f1]);
      assert.ok((await as(tl, "select id from public.field_photos where user_id=$1", [f1])).length > 0);
      assert.equal((await as(tl, "select id from public.field_points where user_id=$1", [f2])).length, 0);
    });
    await check("Employee-role Team Leaders get names through the field directory only", async () => {
      // A TL with the Employee role cannot read other profiles, but field pages need names.
      assert.equal((await as(tl, "select 1 from public.profiles where id=$1", [f1])).length, 0);
      const row = (await as<{ full_name: string; phone?: string }>(tl, "select * from public.field_people where id=$1", [f1]))[0];
      assert.equal(row.full_name, "Field Emp One");
      assert.equal(row.phone, undefined, "no contact details");
      assert.equal((await as(other, "select 1 from public.field_people")).length, 0, "no field access, no directory");
    });
    await check("Admins see only employees within their scope or assignment", async () => {
      await grant(sup, admA, [["field", "view", "self"]]);
      await grant(sup, admB, [["field", "view", "self"]]);
      assert.deepEqual((await as<{ o: { user_id: string }[] }>(admA, "select public.field_overview(current_date) o"))[0].o.map((r) => r.user_id), [f1]);
      assert.deepEqual((await as<{ o: { user_id: string }[] }>(admB, "select public.field_overview(current_date) o"))[0].o.map((r) => r.user_id), [f2]);
      const all = (await as<{ o: { user_id: string }[] }>(sup, "select public.field_overview(current_date) o"))[0].o.map((r) => r.user_id);
      assert.ok(all.includes(f1) && all.includes(f2));
    });
    await check("Other employees cannot read field locations or photos", async () => {
      for (const t of ["field_photos", "field_points", "field_sessions", "field_visits"])
        assert.equal((await as(other, `select 1 from public.${t} where user_id=$1`, [f1])).length, 0, t);
      assert.deepEqual((await as<{ o: unknown[] }>(other, "select public.field_overview(current_date) o"))[0].o, []);
      await rejects(() => as(other, "update public.field_photos set verification='verified' where id=$1", [inside]), /permission denied/);
      await rejects(() => as(f1, "update public.field_photos set verification='verified' where id=$1", [inside]), /permission denied/);
      await rejects(() => as(f1, "insert into public.field_points(session_id,user_id,client_id,latitude,longitude,accuracy_m,captured_at,source) values($1,$2,gen_random_uuid(),1,1,1,now(),'track')", [s1, f1]), /permission denied/);
    });
    await check("TL asks about a photo and the employee replies", async () => {
      await as(tl, "select public.field_review_photo($1,'clarify','Show the serial number')", [inside]);
      await rejects(() => as(f1, "select public.field_review_photo($1,'approve','')", [inside]), /permission to review/);
      await as(f1, "select public.field_reply_photo($1,'Serial is on the second photo')", [inside]);
      const p = (await q<{ review_status: string }>("select review_status from public.field_photos where id=$1", [inside]))[0];
      assert.equal(p.review_status, "pending");
      const f2s = await checkIn(f2).then(() => as<{ id: string }>(f2, "select public.field_start_session() id")).then((r) => r[0].id);
      const p2 = await photo(f2, f2s);
      await rejects(() => as(tl, "select public.field_review_photo($1,'approve','')", [p2.id]), /permission to review/);
    });
    await check("Field report review: submit, question, reply, escalate, approve", async () => {
      report = (await as<{ id: string }>(f1, "select public.field_save_report(null,$1) id", [JSON.stringify({ title: "Acme install", session_id: s1, work_completed: "Installed", photo_ids: [inside], visit_ids: [visit] })]))[0].id;
      await as(f1, "select public.field_report_action($1,'submit',1,'')", [report]);
      assert.ok((await notes(tl)).some((t) => t.startsWith("Field report submitted")), "TL notified");
      await as(tl, "select public.field_report_action($1,'question',2,'Which panel?')", [report]);
      await as(f1, "select public.field_report_action($1,'reply',3,'Panel B')", [report]);
      await rejects(() => as(tl, "select public.field_report_action($1,'approve',4,'')", [report]), /independent authorized reviewer/);
      await as(tl, "select public.field_report_action($1,'escalate',4,'Needs admin sign-off')", [report]);
      assert.ok((await notes(admA)).some((t) => t.startsWith("Field report escalated")), "Admin notified");
      await rejects(() => as(f1, "select public.field_report_action($1,'approve',5,'')", [report]), /independent authorized reviewer/);
      await grant(sup, admA, [["field", "approve", "self"]]);
      await as(admA, "select public.field_report_action($1,'approve',5,'')", [report]);
      const r = (await q<{ status: string; decided_by: string }>("select status,decided_by from public.field_reports where id=$1", [report]))[0];
      assert.deepEqual(r, { status: "Approved", decided_by: admA });
      const events = await q<{ action: string }>("select action from public.field_events where report_id=$1 order by id", [report]);
      assert.deepEqual(events.map((e) => e.action), ["created", "submit", "question", "reply", "escalate", "approve"]);
      const linked = await q("select 1 from public.field_photos where report_id=$1", [report]);
      assert.equal(linked.length, 1);
      assert.ok((await notes(f1)).some((t) => t === "Field report approved"));
    });
    await check("Photo failures alert reviewers (Super Admins when no assigned reviewer may view), without coordinates", async () => {
      // These photos were taken before the TL held field.view, so the alerts fell back to Super Admins.
      const titles = await q<{ title: string; body: string }>("select title,body from public.notifications where user_id=$1 and category='field'", [sup]);
      const failed = titles.filter((t) => t.title.startsWith("GPS photo needs review") || t.title.startsWith("GPS unavailable"));
      assert.ok(failed.length >= 2);
      assert.ok(titles.every((t) => !/\d+\.\d{3,}/.test(t.body)), "no coordinates in notification text");
    });
    await check("Tracking stops when the session ends", async () => {
      const before = point({ captured_at: new Date(Date.now() - 500).toISOString() });
      await as(f1, "select public.field_end_session($1)", [s1]);
      await new Promise((r) => setTimeout(r, 50));
      const after = point({ captured_at: new Date().toISOString() });
      const r = (await as<{ r: { accepted: number; active: boolean } }>(f1, "select public.field_record_points($1,$2) r", [s1, JSON.stringify([after])]))[0].r;
      assert.equal(r.accepted, 0);
      assert.equal(r.active, false);
      assert.ok(before);
      await rejects(() => as(f1, "select public.field_start_visit($1,$2)", [s1, JSON.stringify({ title: "Late" })]), /Start a field session/);
      await rejects(() => photo(f1, s1), /Start a field session/);
    });
    await check("Expired windows and attendance check-out end sessions", async () => {
      const s2 = (await as<{ id: string }>(f1, "select public.field_start_session() id"))[0].id;
      await q("update public.field_sessions set window_end=now()-interval '1 second' where id=$1", [s2]);
      const r = (await as<{ r: { active: boolean } }>(f1, "select public.field_record_points($1,'[]') r", [s2]))[0].r;
      assert.equal(r.active, false);
      assert.equal((await q<{ end_reason: string }>("select end_reason from public.field_sessions where id=$1", [s2]))[0].end_reason, "schedule");
      const s3 = (await as<{ id: string }>(f1, "select public.field_start_session() id"))[0].id;
      await q("update public.records set data=data||jsonb_build_object('clock_out',now()) where module='attendance' and owner_id=$1", [f1]);
      assert.equal((await q<{ end_reason: string }>("select end_reason from public.field_sessions where id=$1", [s3]))[0].end_reason, "checkout");
    });
    await check("Disabling tracking ends the session and blocks new ones", async () => {
      await checkIn(f1);
      const s4 = (await as<{ id: string }>(f1, "select public.field_start_session() id"))[0].id;
      await as(sup, "select public.field_save_assignment($1,$2)", [f1, assignment({ enabled: false, team_leader_id: tl, reporting_admin_id: admA })]);
      assert.equal((await q<{ end_reason: string }>("select end_reason from public.field_sessions where id=$1", [s4]))[0].end_reason, "admin");
      await rejects(() => as(f1, "select public.field_start_session()"), /not enabled/);
    });
    await check("Retention removes old points and photo coordinates", async () => {
      await q("insert into public.field_points(session_id,user_id,client_id,latitude,longitude,accuracy_m,captured_at,source) values($1,$2,gen_random_uuid(),1,1,5,now()-interval '5 years','track')", [s1, f1]);
      await q("update public.field_photos set uploaded_at=now()-interval '5 years' where id=$1", [inside]);
      await q("select public.field_purge()");
      assert.equal((await q("select 1 from public.field_points where session_id=$1 and captured_at<now()-interval '4 years'", [s1])).length, 0);
      const p = (await q<{ latitude: number | null; verification: string }>("select latitude,verification from public.field_photos where id=$1", [inside]))[0];
      assert.deepEqual(p, { latitude: null, verification: "verified" });
      assert.ok((await q("select 1 from public.field_points where session_id=$1", [s1])).length > 0, "recent points kept");
    });
  } finally {
    await reconnect();
    await q("delete from public.permission_audit where target_user = any($1) or actor_id = any($1)", [users]);
    await q("delete from public.permission_grants where user_id = any($1) or updated_by = any($1)", [users]);
    await q("delete from private.push_outbox where notification_id in (select id from public.notifications where user_id = any($1))", [users]);
    await q("delete from public.notifications where user_id = any($1)", [users]);
    await q("delete from public.email_log where user_id = any($1)", [users]);
    await q("delete from public.field_events where actor_id = any($1)", [users]);
    await q("delete from public.field_photos where user_id = any($1)", [users]);
    await q("delete from public.field_visits where user_id = any($1)", [users]);
    await q("delete from public.field_reports where user_id = any($1)", [users]);
    await q("delete from public.field_sessions where user_id = any($1)", [users]);
    await q("delete from public.field_assignments where user_id = any($1)", [users]);
    await q("delete from public.field_audit where actor_id = any($1) or user_id = any($1) or site_id = any($2)", [users, sites]);
    await q("delete from public.field_sites where id = any($1)", [sites]);
    await q("delete from public.history where actor_id = any($1) or record_id in (select id from public.records where owner_id = any($1))", [users]);
    await q("delete from public.records where owner_id = any($1)", [users]);
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
