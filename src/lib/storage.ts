import type { PoolClient } from "pg";
import { transaction } from "./postgres";
import { sessionProfile } from "./auth";
import { validMagic, validateFile } from "./files";
import { randomUUID } from "node:crypto";
export const CHUNK_SIZE = 3 * 1024 * 1024;
export type UploadInfo = {
  record?: string;
  sound?: boolean;
  name: string;
  mime: string;
  size: number;
};
async function checkedUser(c: PoolClient, token: string) {
  const profile = await sessionProfile(c, token);
  if (!profile || profile.must_change_password) throw Error("Please sign in.");
  await c.query("select set_config('app.user_id',$1,true)", [profile.id]);
  return profile;
}
async function recordPermission(
  c: PoolClient,
  record: string,
  action = "view",
) {
  await c.query("set local role techly_user");
  const { rows } = await c.query(
    "select id from public.records where id=$1 and private.permitted(module,$2,owner_id)",
    [record, action],
  );
  await c.query("set local role techly_service");
  if (!rows.length) throw Error("Record unavailable or permission denied");
}
export async function startUpload(token: string, info: UploadInfo) {
  validateFile(info.name, info.mime, info.size, info.sound);
  if (!info.sound && !info.record) throw Error("Select a record");
  return transaction(async (c) => {
    const profile = await checkedUser(c, token);
    // Serialize the quota check for simultaneous upload requests from one user.
    await c.query("select id from private.accounts where id=$1 for update", [
      profile.id,
    ]);
    await c.query("delete from private.uploads where expires_at<=now()");
    const { rows } = await c.query(
      "select coalesce(sum(size),0) as bytes,count(*) as count from private.uploads where user_id=$1",
      [profile.id],
    );
    if (
      Number(rows[0].bytes) + info.size > 100 * 1024 * 1024 ||
      Number(rows[0].count) >= 20
    )
      throw Error("Finish your pending uploads before adding more files.");
    if (!info.sound) await recordPermission(c, info.record!, "upload");
    const path = `${profile.id}/${info.sound ? "sounds" : info.record}/${randomUUID()}.${info.name.split(".").pop()!.toLowerCase()}`;
    const result = await c.query(
      "insert into private.uploads(user_id,record_id,path,name,mime,size,sound) values($1,$2,$3,$4,$5,$6,$7) returning id",
      [
        profile.id,
        info.sound ? null : info.record,
        path,
        info.name,
        info.mime,
        info.size,
        Boolean(info.sound),
      ],
    );
    return { id: result.rows[0].id as string, path, chunkSize: CHUNK_SIZE };
  });
}
export async function saveUploadPart(
  token: string,
  id: string,
  part: number,
  bytes: Buffer,
) {
  if (
    !Number.isInteger(part) ||
    part < 0 ||
    part > 6 ||
    bytes.length < 1 ||
    bytes.length > CHUNK_SIZE
  )
    throw Error("Invalid upload chunk");
  await transaction(async (c) => {
    const profile = await checkedUser(c, token);
    const { rows } = await c.query(
      "select * from private.uploads where id=$1 and user_id=$2 and expires_at>now() for update",
      [id, profile.id],
    );
    const upload = rows[0];
    if (!upload) throw Error("Upload expired. Please start again.");
    const remaining = upload.size - part * CHUNK_SIZE;
    if (remaining <= 0 || bytes.length !== Math.min(remaining, CHUNK_SIZE))
      throw Error("Incorrect chunk length");
    await c.query(
      "insert into private.upload_parts(upload_id,part,content) values($1,$2,$3) on conflict(upload_id,part) do update set content=excluded.content",
      [id, part, bytes],
    );
  });
}
export async function finishUpload(token: string, id: string) {
  return transaction(async (c) => {
    const profile = await checkedUser(c, token);
    const { rows } = await c.query(
      "select * from private.uploads where id=$1 and user_id=$2 and expires_at>now() for update",
      [id, profile.id],
    );
    const upload = rows[0];
    if (!upload) throw Error("Upload expired or already completed");
    if (!upload.sound) await recordPermission(c, upload.record_id, "upload");
    const parts = await c.query(
      "select part,content from private.upload_parts where upload_id=$1 order by part",
      [id],
    );
    if (
      parts.rows.length !== Math.ceil(upload.size / CHUNK_SIZE) ||
      parts.rows.some((r, i) => r.part !== i)
    )
      throw Error("Upload is incomplete");
    const bytes = Buffer.concat(parts.rows.map((r) => r.content));
    if (bytes.length !== upload.size || !validMagic(bytes, upload.mime))
      throw Error("File contents do not match the approved format");
    await c.query(
      "insert into private.stored_files(path,uploaded_by,record_id,name,mime,size,content) values($1,$2,$3,$4,$5,$6,$7)",
      [
        upload.path,
        profile.id,
        upload.record_id,
        upload.name,
        upload.mime,
        upload.size,
        bytes,
      ],
    );
    if (!upload.sound) {
      await c.query("set local role techly_user");
      await c.query("select public.attach_file($1,$2,$3,$4,$5)", [
        upload.record_id,
        upload.path,
        upload.name,
        upload.mime,
        upload.size,
      ]);
      await c.query("set local role techly_service");
    }
    await c.query("delete from private.uploads where id=$1", [id]);
    return { path: upload.path as string };
  });
}
export async function downloadFile(
  token: string,
  reference: string,
  sound = false,
) {
  return transaction(async (c) => {
    const profile = await checkedUser(c, token);
    let path = reference;
    if (!sound) {
      await c.query("set local role techly_user");
      const result = await c.query(
        "select path from public.attachments where id=$1",
        [reference],
      );
      await c.query("set local role techly_service");
      if (!result.rows.length) throw Error("File unavailable");
      path = result.rows[0].path;
    } else if (!path.startsWith(profile.id + "/sounds/"))
      throw Error("Permission denied");
    const { rows } = await c.query(
      "select name,mime,size,content from private.stored_files where path=$1",
      [path],
    );
    if (!rows.length) throw Error("File unavailable");
    return rows[0] as {
      name: string;
      mime: string;
      size: number;
      content: Buffer;
    };
  });
}
