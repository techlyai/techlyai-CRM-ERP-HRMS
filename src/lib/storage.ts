import type { PoolClient } from "pg";
import { transaction } from "./postgres";
import { sessionProfile } from "./auth";
import { validMagic, validateFile } from "./files";
import { randomUUID } from "node:crypto";
import { parseChatPath } from "../components/chat/helpers";
export const CHUNK_SIZE = 3 * 1024 * 1024;
export type UploadInfo = {
  record?: string;
  sound?: boolean;
  /** Chat attachment target; mutually exclusive with record and sound. */
  conversation?: string;
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
// Chat uploads require current membership; RLS on conversation_members enforces it.
async function conversationMembership(c: PoolClient, conversation: string) {
  await c.query("set local role techly_user");
  const { rows } = await c.query(
    "select 1 from public.conversation_members where conversation_id=$1 and user_id=private.current_user_id()",
    [conversation],
  );
  await c.query("set local role techly_service");
  if (!rows.length) throw Error("You are not part of this conversation");
}
export async function startUpload(token: string, info: UploadInfo) {
  validateFile(info.name, info.mime, info.size, info.sound);
  if (info.conversation && (info.record || info.sound))
    throw Error("Choose a record or a conversation, not both");
  if (info.conversation && info.mime.startsWith("audio/"))
    throw Error("Use JPG, PNG, WebP, PDF, DOCX, XLSX, or CSV files in chat.");
  if (!info.sound && !info.record && !info.conversation)
    throw Error("Select a record");
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
    if (info.conversation) await conversationMembership(c, info.conversation);
    else if (!info.sound) await recordPermission(c, info.record!, "upload");
    const folder = info.sound
      ? "sounds"
      : info.conversation
        ? "chat/" + info.conversation
        : info.record;
    const path = `${profile.id}/${folder}/${randomUUID()}.${info.name.split(".").pop()!.toLowerCase()}`;
    const result = await c.query(
      "insert into private.uploads(user_id,record_id,conversation_id,path,name,mime,size,sound) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
      [
        profile.id,
        info.sound || info.conversation ? null : info.record,
        info.conversation || null,
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
    if (upload.conversation_id)
      await conversationMembership(c, upload.conversation_id);
    else if (!upload.sound)
      await recordPermission(c, upload.record_id, "upload");
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
    if (!upload.sound && !upload.conversation_id) {
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
    return {
      path: upload.path as string,
      name: upload.name as string,
      mime: upload.mime as string,
      size: Number(upload.size),
    };
  });
}
// Chat attachments are readable by conversation members and Admin reviewers only.
export async function downloadConversationFile(token: string, path: string) {
  const parts = parseChatPath(path);
  if (!parts) throw Error("File unavailable");
  return transaction(async (c) => {
    const profile = await checkedUser(c, token);
    await c.query("set local role techly_user");
    const access = await c.query(
      "select (private.is_member($1) or private.can_review($1)) as allowed, exists(select 1 from public.messages m where m.conversation_id=$1 and m.attachment_path=$2 and m.deleted_at is null) as referenced",
      [parts.conversation, path],
    );
    await c.query("set local role techly_service");
    const row = access.rows[0];
    // Files not attached to a live message stay private to their uploader.
    if (!row?.allowed || !(row.referenced || parts.uploader === profile.id))
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
