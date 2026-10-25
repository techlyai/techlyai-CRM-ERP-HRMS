import type { PoolClient } from "pg";
import { transaction } from "./postgres";
import { sessionProfile } from "./auth";
import {
  validMagic,
  validateFile,
  pdfHasEnd,
  INLINE_LIMIT,
  type FileKind,
} from "./files";
import { randomUUID } from "node:crypto";
import { parseChatPath } from "../components/chat/helpers";
export const CHUNK_SIZE = 3 * 1024 * 1024;
export type UploadInfo = {
  record?: string;
  sound?: boolean;
  /** Chat attachment target; mutually exclusive with record and sound. */
  conversation?: string;
  /** "joining" marks an employee's combined joining-documents PDF. */
  kind?: FileKind;
  /** Field photo or field report id, for the field_* kinds. */
  fieldTarget?: string;
  name: string;
  mime: string;
  size: number;
};
/**
 * A stored file ready to send. Small files carry their bytes; large files are
 * read one chunk at a time so the server never holds the whole file.
 */
export type StoredFile = {
  name: string;
  mime: string;
  size: number;
  content?: Buffer;
  readChunk?: (part: number) => Promise<Buffer>;
  chunkSize?: number;
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
    "select id,module from public.records where id=$1 and private.permitted(module,$2,owner_id)",
    [record, action],
  );
  await c.query("set local role techly_service");
  if (!rows.length) throw Error("Record unavailable or permission denied");
  return rows[0] as { id: string; module: string };
}
// Field photos and report files: the database checks ownership and state.
async function fieldTarget(c: PoolClient, kind: FileKind, target: string, mime: string, size: number) {
  await c.query("set local role techly_user");
  const { rows } = await c.query("select public.field_upload_allowed($1,$2,$3,$4) ok", [kind, target, mime, size]);
  await c.query("set local role techly_service");
  if (!rows[0]?.ok) throw Error("This photo or report can no longer receive files");
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
  const kind: FileKind = info.kind || "general";
  validateFile(info.name, info.mime, info.size, info.sound, kind);
  if (info.conversation && (info.record || info.sound))
    throw Error("Choose a record or a conversation, not both");
  if (info.conversation && info.mime.startsWith("audio/"))
    throw Error("Use JPG, PNG, WebP, PDF, DOCX, XLSX, or CSV files in chat.");
  if (kind === "joining" && (info.sound || info.conversation || !info.record))
    throw Error("Joining documents belong to an employee record");
  const field = kind === "field_photo" || kind === "field_report";
  if (field && (info.sound || info.conversation || info.record || !info.fieldTarget))
    throw Error("Field files belong to a field photo or report");
  if (!field && info.fieldTarget) throw Error("Invalid upload target");
  if (!field && !info.sound && !info.record && !info.conversation)
    throw Error("Select a record");
  return transaction(async (c) => {
    const profile = await checkedUser(c, token);
    // Serialize the quota check for simultaneous upload requests from one user.
    await c.query("select id from private.accounts where id=$1 for update", [
      profile.id,
    ]);
    await c.query("delete from private.uploads where expires_at<=now()");
    const { rows } = await c.query(
      "select coalesce(sum(size) filter(where kind<>'joining'),0) as bytes,count(*) as count from private.uploads where user_id=$1",
      [profile.id],
    );
    // Joining PDFs have no size quota; the pending-upload count still applies.
    if (
      (kind !== "joining" &&
        Number(rows[0].bytes) + info.size > 100 * 1024 * 1024) ||
      Number(rows[0].count) >= 20
    )
      throw Error("Finish your pending uploads before adding more files.");
    if (field) await fieldTarget(c, kind, info.fieldTarget!, info.mime, info.size);
    else if (info.conversation) await conversationMembership(c, info.conversation);
    else if (!info.sound) {
      const target = await recordPermission(c, info.record!, "upload");
      if (kind === "joining" && target.module !== "employees")
        throw Error("Joining documents belong to an employee record");
    }
    const folder = field
      ? "field/" + info.fieldTarget
      : info.sound
      ? "sounds"
      : info.conversation
        ? "chat/" + info.conversation
        : info.record;
    const path = `${profile.id}/${folder}/${randomUUID()}.${info.name.split(".").pop()!.toLowerCase()}`;
    const result = await c.query(
      "insert into private.uploads(user_id,record_id,conversation_id,path,name,mime,size,sound,kind,field_target) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id",
      [
        profile.id,
        info.sound || info.conversation ? null : info.record,
        info.conversation || null,
        path,
        info.name,
        info.mime,
        info.size,
        Boolean(info.sound),
        kind,
        field ? info.fieldTarget : null,
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
    !Number.isSafeInteger(part) ||
    part < 0 ||
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
    const remaining = Number(upload.size) - part * CHUNK_SIZE;
    if (remaining <= 0 || bytes.length !== Math.min(remaining, CHUNK_SIZE))
      throw Error("Incorrect chunk length");
    await c.query(
      "insert into private.upload_parts(upload_id,part,content) values($1,$2,$3) on conflict(upload_id,part) do update set content=excluded.content",
      [id, part, bytes],
    );
    // Large uploads stay alive while pieces keep arriving.
    await c.query(
      "update private.uploads set expires_at=greatest(expires_at,now()+interval '1 hour') where id=$1",
      [id],
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
    const size = Number(upload.size);
    const kind: FileKind = upload.kind || "general";
    const field = kind === "field_photo" || kind === "field_report";
    if (field) await fieldTarget(c, kind, upload.field_target, upload.mime, size);
    else if (upload.conversation_id)
      await conversationMembership(c, upload.conversation_id);
    else if (!upload.sound)
      await recordPermission(c, upload.record_id, "upload");
    // Check completeness from metadata only, without loading file contents.
    const expected = Math.ceil(size / CHUNK_SIZE);
    const summary = (
      await c.query(
        "select count(*)::int n,coalesce(min(part),0) lo,coalesce(max(part),-1) hi,coalesce(sum(octet_length(content)),0)::bigint total from private.upload_parts where upload_id=$1",
        [id],
      )
    ).rows[0];
    if (
      summary.n !== expected ||
      summary.lo !== 0 ||
      summary.hi !== expected - 1 ||
      Number(summary.total) !== size
    )
      throw Error("Upload is incomplete");
    const head = (
      await c.query(
        "select substring(content from 1 for 16) b from private.upload_parts where upload_id=$1 and part=0",
        [id],
      )
    ).rows[0].b as Buffer;
    if (!validMagic(head, upload.mime))
      throw Error("File contents do not match the approved format");
    if (upload.mime === "application/pdf") {
      const tail = (
        await c.query(
          "select substring(content from greatest(1,octet_length(content)-2047)) b from private.upload_parts where upload_id=$1 and part=$2",
          [id, expected - 1],
        )
      ).rows[0].b as Buffer;
      if (!pdfHasEnd(tail))
        throw Error("This PDF looks incomplete or damaged. Please export it again.");
    }
    if (size <= INLINE_LIMIT && kind === "general") {
      const parts = await c.query(
        "select content from private.upload_parts where upload_id=$1 order by part",
        [id],
      );
      await c.query(
        "insert into private.stored_files(path,uploaded_by,record_id,name,mime,size,content) values($1,$2,$3,$4,$5,$6,$7)",
        [
          upload.path,
          profile.id,
          upload.record_id,
          upload.name,
          upload.mime,
          size,
          Buffer.concat(parts.rows.map((r) => r.content)),
        ],
      );
    } else {
      // Large files: pieces are copied inside PostgreSQL, never through server memory.
      await c.query(
        "insert into private.stored_files(path,uploaded_by,record_id,name,mime,size,content,chunked) values($1,$2,$3,$4,$5,$6,null,true)",
        [upload.path, profile.id, upload.record_id, upload.name, upload.mime, size],
      );
      await c.query(
        "insert into private.stored_file_chunks(path,part,content) select $1,part,content from private.upload_parts where upload_id=$2",
        [upload.path, id],
      );
    }
    if (field) {
      await c.query("set local role techly_user");
      await c.query("select public.field_attach_upload($1,$2,$3,$4,$5,$6)", [
        kind,
        upload.field_target,
        upload.path,
        upload.name,
        upload.mime,
        size,
      ]);
      await c.query("set local role techly_service");
    } else if (!upload.sound && !upload.conversation_id) {
      await c.query("set local role techly_user");
      await c.query("select public.attach_file($1,$2,$3,$4,$5,$6)", [
        upload.record_id,
        upload.path,
        upload.name,
        upload.mime,
        size,
        kind,
      ]);
      await c.query("set local role techly_service");
    }
    await c.query("delete from private.uploads where id=$1", [id]);
    return {
      path: upload.path as string,
      name: upload.name as string,
      mime: upload.mime as string,
      size,
    };
  });
}
/** Loads a stored file's metadata, and its bytes when it is small. */
async function loadStored(c: PoolClient, path: string): Promise<StoredFile> {
  const { rows } = await c.query(
    "select name,mime,size,chunked,case when chunked then null else content end as content from private.stored_files where path=$1",
    [path],
  );
  if (!rows.length) throw Error("File unavailable");
  const row = rows[0];
  if (!row.chunked)
    return { name: row.name, mime: row.mime, size: Number(row.size), content: row.content };
  // Access was authorized above; each chunk is then read in its own short query.
  return {
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    chunkSize: CHUNK_SIZE,
    readChunk: (part: number) =>
      transaction(async (k) => {
        const r = await k.query(
          "select content from private.stored_file_chunks where path=$1 and part=$2",
          [path, part],
        );
        if (!r.rows.length) throw Error("File unavailable");
        return r.rows[0].content as Buffer;
      }),
  };
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
    return loadStored(c, path);
  });
}
/** A field photo or report file; row level security decides who may read it. */
export async function downloadFieldFile(token: string, kind: "photo" | "report", id: string) {
  return transaction(async (c) => {
    await checkedUser(c, token);
    await c.query("set local role techly_user");
    const { rows } = await c.query(
      kind === "photo"
        ? "select file_path as path from public.field_photos where id=$1 and file_path is not null"
        : "select path from public.field_report_files where id=$1",
      [id],
    );
    await c.query("set local role techly_service");
    if (!rows.length) throw Error("File unavailable");
    return loadStored(c, rows[0].path);
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
    return loadStored(c, path);
  });
}
