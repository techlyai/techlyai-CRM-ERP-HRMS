export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/database";
import { loadChatPresence } from "@/lib/chat-presence";
import {
  isOnline,
  readersOf,
  type ChatMessage,
  type Member,
  type ReplyPreview,
} from "@/components/chat/helpers";
import {
  chunk,
  fail,
  filter,
  handle,
  inList,
  json,
  namesFor,
  nameOf,
  unique,
} from "../shared";
type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  department: string | null;
  project_id: string | null;
  official: boolean;
  created_by: string;
  created_at: string;
  last_message_at: string | null;
};
type MemberRow = {
  user_id: string;
  role: "member" | "admin";
  muted: boolean;
  pinned: boolean;
  last_read_at: string;
};
type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  reply_to: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  pinned: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};
const PAGE = 100;
const query = z.object({
  conversation: z.string().uuid(),
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { db, profile } = await context();
    const sp = req.nextUrl.searchParams;
    const params = query.parse({
      conversation: sp.get("conversation"),
      after: sp.get("after") || undefined,
      before: sp.get("before") || undefined,
    });
    const id = params.conversation;
    const me = profile.id;
    const base = { select: "*", conversation_id: "eq." + id };
    // RLS: members, or Super Admins with review rights, see the conversation.
    const [conversation] = await db.select<ConversationRow>(
      "conversations",
      filter({ select: "*", id: "eq." + id }),
    );
    if (!conversation) return fail("Conversation unavailable", 403);
    const memberRows = await db.select<MemberRow>(
      "conversation_members",
      filter({
        select: "user_id,role,muted,pinned,last_read_at",
        conversation_id: "eq." + id,
      }),
    );
    let rows: MessageRow[] = [];
    let hasMore = false;
    if (params.after) {
      // New, edited and removed messages since the client's cursor.
      const since = params.after;
      const batches = await Promise.all([
        db.select<MessageRow>(
          "messages",
          filter({
            ...base,
            created_at: "gt." + since,
            order: "created_at.asc",
            limit: "200",
          }),
        ),
        db.select<MessageRow>(
          "messages",
          filter({
            ...base,
            edited_at: "gt." + since,
            order: "created_at.asc",
            limit: "100",
          }),
        ),
        db.select<MessageRow>(
          "messages",
          filter({
            ...base,
            deleted_at: "gt." + since,
            order: "created_at.asc",
            limit: "100",
          }),
        ),
      ]);
      const seen = new Map<string, MessageRow>();
      for (const batch of batches)
        for (const row of batch) seen.set(row.id, row);
      rows = Array.from(seen.values());
    } else if (params.before) {
      rows = (
        await db.select<MessageRow>(
          "messages",
          filter({
            ...base,
            created_at: "lt." + params.before,
            order: "created_at.desc",
            limit: String(PAGE),
          }),
        )
      ).reverse();
      hasMore = rows.length === PAGE;
    } else {
      rows = (
        await db.select<MessageRow>(
          "messages",
          filter({ ...base, order: "created_at.desc", limit: String(PAGE) }),
        )
      ).reverse();
      hasMore = rows.length === PAGE;
    }
    const pinnedRows = await db.select<MessageRow>(
      "messages",
      filter({
        ...base,
        pinned: "eq.true",
        deleted_at: "is.null",
        order: "created_at.desc",
        limit: "20",
      }),
    );
    // Reply targets that are not part of this batch.
    const loaded = new Map<string, MessageRow>();
    for (const r of [...rows, ...pinnedRows]) loaded.set(r.id, r);
    const missing = unique(
      [...rows, ...pinnedRows]
        .map((r) => r.reply_to)
        .filter((r) => r && !loaded.has(r)),
    );
    const replyRows: MessageRow[] = [];
    for (const part of chunk(missing))
      replyRows.push(
        ...(await db.select<MessageRow>(
          "messages",
          filter({ select: "*", id: inList(part) }),
        )),
      );
    for (const r of replyRows) loaded.set(r.id, r);
    const memberIds = memberRows.map((m) => m.user_id);
    const presence = await loadChatPresence(db, memberIds);
    const names = await namesFor([
      ...memberIds,
      ...rows.map((r) => r.sender_id),
      ...pinnedRows.map((r) => r.sender_id),
      ...replyRows.map((r) => r.sender_id),
    ]);
    const now = new Date();
    const seen = new Map(presence.map((p) => [p.user_id, p]));
    const members: Member[] = memberRows.map((m) => ({
      id: m.user_id,
      name: nameOf(names, m.user_id),
      role: names.get(m.user_id)?.role || "employee",
      online: isOnline(seen.get(m.user_id)?.last_seen_at, now),
      group_role: m.role,
      last_seen_at: seen.get(m.user_id)?.last_seen_at || null,
      last_read_at: m.last_read_at,
    }));
    const typing = presence
      .filter(
        (p) =>
          p.user_id !== me &&
          p.typing_conversation === id &&
          p.typing_at &&
          now.getTime() - Date.parse(p.typing_at) < 8000,
      )
      .map((p) => nameOf(names, p.user_id));
    const preview = (target: string | null): ReplyPreview | null => {
      const r = target ? loaded.get(target) : undefined;
      if (!r) return null;
      return {
        id: r.id,
        sender_name: nameOf(names, r.sender_id),
        body: r.deleted_at ? "" : r.body,
        deleted: Boolean(r.deleted_at),
        attachment_name: r.attachment_name,
      };
    };
    const shape = (r: MessageRow): ChatMessage => ({
      id: r.id,
      conversation_id: r.conversation_id,
      sender_id: r.sender_id,
      sender_name: nameOf(names, r.sender_id),
      body: r.body,
      reply_to: r.reply_to,
      reply: preview(r.reply_to),
      attachment:
        r.attachment_path && r.attachment_name && r.attachment_mime
          ? {
              path: r.attachment_path,
              name: r.attachment_name,
              mime: r.attachment_mime,
              size: Number(r.attachment_size) || 0,
            }
          : null,
      pinned: r.pinned,
      edited_at: r.edited_at,
      deleted_at: r.deleted_at,
      created_at: r.created_at,
      read_by: r.sender_id === me ? readersOf(r, members, me) : [],
    });
    const mine = memberRows.find((m) => m.user_id === me);
    return json({
      me,
      conversation: {
        ...conversation,
        members,
        muted: mine?.muted ?? false,
        pinned: mine?.pinned ?? false,
        role: mine?.role ?? null,
        review: !mine,
      },
      messages: rows.map(shape),
      pinned: pinnedRows.map(shape),
      typing,
      hasMore,
      now: now.toISOString(),
    });
  });
}
