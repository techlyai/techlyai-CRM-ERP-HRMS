/**
 * End-to-end check of joining-document storage against a real database.
 * Creates disposable users and records, exercises upload/download through the
 * same functions the API uses, and removes everything afterwards.
 *
 *   DATABASE_URL=... DATABASE_ADMIN_URL=... node scripts/run-ts.cjs scripts/verify-joining-storage.ts
 *
 * Fixtures and cleanup run through the application's own connection using
 * the server-only service role, so a single-connection database also works.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { tokenHash } from "../src/lib/passwords";
import { startUpload, saveUploadPart, finishUpload, downloadFile, CHUNK_SIZE } from "../src/lib/storage";
import { fileResponse } from "../src/lib/file-response";
import { pool, transaction } from "../src/lib/postgres";

/** Drops pooled connections; used after expected errors on fragile test servers. */
async function resetPool() {
  const g = globalThis as typeof globalThis & { techlyPool?: { end(): Promise<void> } };
  await g.techlyPool?.end().catch(() => undefined);
  g.techlyPool = undefined;
  // Single-connection test servers release the slot asynchronously.
  await new Promise((r) => setTimeout(r, 1500));
}
async function expectReject(p: Promise<unknown>, re: RegExp) {
  try {
    await assert.rejects(p, re);
  } finally {
    await resetPool();
  }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function fakePdf(bytes: number) {
  const head = Buffer.from("%PDF-1.7\n");
  const tail = Buffer.from("\ntrailer\n%%EOF\n");
  return Buffer.concat([head, randomBytes(bytes - head.length - tail.length), tail]);
}
async function upload(token: string, record: string, name: string, data: Buffer, kind?: "joining") {
  const t = await startUpload(token, { record, name, mime: "application/pdf", size: data.length, kind });
  for (let part = 0; part * CHUNK_SIZE < data.length; part++)
    await saveUploadPart(token, t.id, part, data.subarray(part * CHUNK_SIZE, (part + 1) * CHUNK_SIZE));
  return finishUpload(token, t.id);
}
async function collect(res: Response) {
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const q = (sql: string, p: unknown[] = []) =>
    transaction(async (c) => (await c.query(sql, p)).rows);
  const results: string[] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push("PASS " + name);
    } catch (e) {
      results.push("FAIL " + name + " → " + (e instanceof Error ? e.message : e));
    }
  };
  // Fixtures: an HR admin (super_admin) and an unrelated employee, each with a session.
  const mk = async (name: string, role: string) => {
    const id = (await q("insert into private.accounts(password_hash) values('scrypt:x:y') returning id"))[0].id as string;
    await q("insert into public.profiles(id,full_name,phone,role,must_change_password) values($1,$2,$3,$4,false)", [id, name, "+9192" + Math.floor(1e7 + Math.random() * 9e7), role]);
    const token = randomBytes(32).toString("hex");
    await q("insert into private.sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [tokenHash(token), id]);
    return { id, token };
  };
  const hr = await mk("Joining HR", "super_admin");
  const other = await mk("Joining Outsider", "employee");
  const asUser = <T,>(uid: string, sql: string, p: unknown[]) =>
    transaction(async (c) => {
      await c.query("select set_config('app.user_id',$1,true)", [uid]);
      await c.query("set local role techly_user");
      return (await c.query(sql, p)).rows as T[];
    });
  const employee = (await asUser<{ id: string }>(hr.id, "select public.save_record('employees','Joining Test Employee',$1,$2) id", [JSON.stringify({ phone: "+919800000001", department: "Ops", joining_date: "2026-10-01", joining_documents: ["Resume"] }), other.id]))[0].id;
  const client = (await asUser<{ id: string }>(hr.id, "select public.save_record('clients','Joining Test Client',$1,$2) id", [JSON.stringify({ contact: "X", phone: "+919800000002" }), hr.id]))[0].id;
  try {
    const big = fakePdf(50 * 1024 * 1024 + 12345); // ~50 MB, 17 chunks
    await check("50 MB joining PDF uploads through the chunked path", async () => {
      const r = await upload(hr.token, employee, "joining-documents.pdf", big, "joining");
      assert.equal(r.size, big.length);
      const row = (await q("select chunked,content is null empty,(select count(*)::int from private.stored_file_chunks c where c.path=s.path) n from private.stored_files s where path=$1", [r.path]))[0];
      assert.equal(row.chunked, true);
      assert.equal(row.empty, true);
      assert.equal(row.n, Math.ceil(big.length / CHUNK_SIZE));
      const a = (await q("select kind from public.attachments where path=$1", [r.path]))[0];
      assert.equal(a.kind, "joining");
    });
    await check("full download is byte-identical", async () => {
      const id = (await q("select id from public.attachments where record_id=$1 and kind='joining'", [employee]))[0].id;
      const file = await downloadFile(hr.token, id);
      const res = fileResponse(new NextRequest("https://app.test/api/files/" + id), file);
      assert.equal(res.headers.get("Content-Length"), String(big.length));
      assert.equal(sha(await collect(res)), sha(big));
    });
    await check("range download across chunk boundaries is exact", async () => {
      const id = (await q("select id from public.attachments where record_id=$1 and kind='joining'", [employee]))[0].id;
      const file = await downloadFile(hr.token, id);
      const start = CHUNK_SIZE * 2 - 100, end = CHUNK_SIZE * 4 + 50;
      const res = fileResponse(new NextRequest("https://app.test/x", { headers: { range: `bytes=${start}-${end}` } }), file);
      assert.equal(res.status, 206);
      assert.equal(sha(await collect(res)), sha(big.subarray(start, end + 1)));
    });
    await check("small attachments still use the single-value layout", async () => {
      const small = fakePdf(200 * 1024);
      const r = await upload(hr.token, employee, "offer.pdf", small);
      const row = (await q("select chunked,octet_length(content) n from private.stored_files where path=$1", [r.path]))[0];
      assert.equal(row.chunked, false);
      assert.equal(row.n, small.length);
    });
    await check("joining PDFs are refused on non-employee records", async () => {
      await expectReject(upload(hr.token, client, "joining.pdf", fakePdf(10000), "joining"), /employee record/);
    });
    await check("truncated PDFs are refused", async () => {
      const cut = fakePdf(4 * 1024 * 1024).subarray(0, 4 * 1024 * 1024 - 10);
      await expectReject(upload(hr.token, employee, "cut.pdf", Buffer.from(cut), "joining"), /incomplete or damaged/);
    });
    await check("incomplete uploads cannot be finished", async () => {
      const data = fakePdf(7 * 1024 * 1024);
      const t = await startUpload(hr.token, { record: employee, name: "j.pdf", mime: "application/pdf", size: data.length, kind: "joining" });
      await saveUploadPart(hr.token, t.id, 0, data.subarray(0, CHUNK_SIZE));
      await expectReject(finishUpload(hr.token, t.id), /incomplete/);
    });
    await check("joining uploads are not limited by the 100 MB pending quota", async () => {
      const t = await startUpload(hr.token, { record: employee, name: "huge.pdf", mime: "application/pdf", size: 3 * 1024 * 1024 * 1024, kind: "joining" });
      assert.ok(t.id);
    });
    await check("a user without access cannot upload or download", async () => {
      const outsider = await mk("Joining Stranger", "employee");
      await expectReject(upload(outsider.token, employee, "x.pdf", fakePdf(10000), "joining"), /permission denied/i);
      const id = (await q("select id from public.attachments where record_id=$1 and kind='joining'", [employee]))[0].id;
      await expectReject(downloadFile(outsider.token, id), /unavailable/);
    });
  } finally {
    console.log(results.join("\n"));
    const failed = results.filter((r) => r.startsWith("FAIL")).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
    await pool().end().catch(() => undefined);
    await cleanup([employee, client], [hr.id, other.id]);
  }
}
/** Removes fixtures with the owner connection (some queue tables are owner-only). */
async function cleanup(recs: string[], users: string[]) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    console.log("Set DATABASE_ADMIN_URL to remove test fixtures automatically.");
    return;
  }
  const { Client } = await import("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  const q = (sql: string, p: unknown[]) => c.query(sql, p);
  try {
    await q("delete from private.uploads where record_id = any($1) or user_id = any($2)", [recs, users]);
    await q("delete from public.attachments where record_id = any($1)", [recs]);
    await q("delete from private.stored_files where record_id = any($1)", [recs]);
    await q("delete from public.history where record_id = any($1) or actor_id = any($2)", [recs, users]);
    await q("delete from private.push_outbox where notification_id in (select id from public.notifications where record_id = any($1) or user_id = any($2))", [recs, users]);
    await q("delete from public.notifications where record_id = any($1) or user_id = any($2)", [recs, users]);
    await q("delete from public.email_log where record_id = any($1) or user_id = any($2)", [recs, users]);
    await q("delete from public.records where id = any($1)", [recs]);
    await q("delete from private.sessions where user_id = any($1)", [users]);
    await q("delete from public.profiles where id = any($1) or full_name = 'Joining Stranger'", [users]);
    await q("delete from private.accounts where id not in (select id from public.profiles)", []);
    console.log("Fixtures removed.");
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error("SCRIPT ERROR", e);
  process.exitCode = 2;
});
