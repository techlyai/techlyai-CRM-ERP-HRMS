export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { context } from "@/lib/database";
import type {
  Conversation,
  Member,
  MessageReport,
} from "@/components/chat/helpers";
import {
  chunk,
  filter,
  handle,
  inList,
  json,
  namesFor,
  nameOf,
  unique,
} from "../shared";
type OverviewRow = Omit<Conversation, "members" | "unread"> & {
  members: Member[] | null;
  unread: number | string;
};
type ReviewRow = {
  id: string;
  kind: "direct" | "group";
  name: string | null;
  department: string | null;
  project_id: string | null;
  official: boolean;
  last_message_at: string | null;
};
export async function GET() {
  return handle(async () => {
    const { db, profile } = await context();
    const rows = (await db.rpc<OverviewRow[] | null>("chat_overview")) || [];
    const conversations: Conversation[] = rows.map((c) => ({
      ...c,
      members: c.members || [],
      unread: Number(c.unread) || 0,
      review: false,
    }));
    const review: Conversation[] = [];
    const reports: MessageReport[] = [];
    if (profile.role === "super_admin") {
      // Conversations visible through Admin review (official groups, or every
      // conversation when the transparent review policy is on).
      const known = new Set(conversations.map((c) => c.id));
      const all = await db.select<ReviewRow>(
        "conversations",
        filter({
          select: "id,kind,name,department,project_id,official,last_message_at",
          order: "last_message_at.desc",
          limit: "200",
        }),
      );
      const extra = all.filter((c) => !known.has(c.id));
      if (extra.length) {
        const members: { conversation_id: string; user_id: string; role: "member" | "admin" }[] = [];
        for (const part of chunk(extra.map((c) => c.id)))
          members.push(
            ...(await db.select<(typeof members)[number]>(
              "conversation_members",
              filter({
                select: "conversation_id,user_id,role",
                conversation_id: inList(part),
              }),
            )),
          );
        const names = await namesFor(members.map((m) => m.user_id));
        for (const c of extra)
          review.push({
            ...c,
            muted: false,
            pinned: false,
            role: null,
            unread: 0,
            last: null,
            review: true,
            members: members
              .filter((m) => m.conversation_id === c.id)
              .map((m) => ({
                id: m.user_id,
                name: nameOf(names, m.user_id),
                role: names.get(m.user_id)?.role || "employee",
                online: false,
                group_role: m.role,
              })),
          });
      }
      const open = await db.select<{
        id: string;
        message_id: string;
        reporter_id: string;
        reason: string;
        status: "open";
        created_at: string;
      }>(
        "message_reports",
        filter({
          select: "id,message_id,reporter_id,reason,status,created_at",
          status: "eq.open",
          order: "created_at.desc",
          limit: "100",
        }),
      );
      if (open.length) {
        const located = new Map<string, string>();
        for (const part of chunk(unique(open.map((r) => r.message_id))))
          for (const m of await db.select<{ id: string; conversation_id: string }>(
            "messages",
            filter({ select: "id,conversation_id", id: inList(part) }),
          ))
            located.set(m.id, m.conversation_id);
        const names = await namesFor(open.map((r) => r.reporter_id));
        for (const r of open)
          reports.push({
            ...r,
            conversation_id: located.get(r.message_id) ?? null,
            reporter_name: nameOf(names, r.reporter_id),
          });
      }
    }
    const unread = conversations.reduce(
      (n, c) => n + (c.muted ? 0 : c.unread),
      0,
    );
    return json({
      me: profile.id,
      conversations,
      review,
      reports,
      unread,
      now: new Date().toISOString(),
    });
  });
}
