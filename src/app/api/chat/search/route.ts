export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { context } from "@/lib/database";
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
type Hit = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { db, profile } = await context();
    const q = z
      .string()
      .trim()
      .min(1)
      .max(100)
      .parse(req.nextUrl.searchParams.get("q") || "");
    // RLS limits the scan to conversations the caller can see.
    const hits = await db.select<Hit>(
      "messages",
      filter({
        select: "id,conversation_id,sender_id,body,created_at",
        body: "ilike.*" + q.replace(/[%_]/g, "") + "*",
        deleted_at: "is.null",
        order: "created_at.desc",
        limit: "50",
      }),
    );
    const conversations = new Map<string, { kind: string; name: string | null }>();
    for (const part of chunk(unique(hits.map((h) => h.conversation_id))))
      for (const c of await db.select<{ id: string; kind: string; name: string | null }>(
        "conversations",
        filter({ select: "id,kind,name", id: inList(part) }),
      ))
        conversations.set(c.id, c);
    const names = await namesFor(hits.map((h) => h.sender_id));
    return json({
      me: profile.id,
      query: q,
      results: hits.map((h) => ({
        id: h.id,
        conversation_id: h.conversation_id,
        conversation_kind: conversations.get(h.conversation_id)?.kind || "direct",
        conversation_name: conversations.get(h.conversation_id)?.name || null,
        sender_id: h.sender_id,
        sender_name: nameOf(names, h.sender_id),
        body: h.body.length > 160 ? h.body.slice(0, 160) + "…" : h.body,
        created_at: h.created_at,
      })),
    });
  });
}
