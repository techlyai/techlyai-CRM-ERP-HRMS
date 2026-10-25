import type { Database } from "./database";

export type PresenceRow = {
  user_id: string;
  last_seen_at: string;
  typing_conversation: string | null;
  typing_at: string | null;
};

/** Group membership can exceed the query layer's 100-value IN filter limit. */
export async function loadChatPresence(
  db: Pick<Database, "select">,
  memberIds: string[],
): Promise<PresenceRow[]> {
  const ids = Array.from(new Set(memberIds));
  const rows: PresenceRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const query = new URLSearchParams({
      select: "user_id,last_seen_at,typing_conversation,typing_at",
      user_id: "in.(" + ids.slice(offset, offset + 100).join(",") + ")",
    });
    rows.push(...(await db.select<PresenceRow>("presence", query.toString())));
  }
  return rows;
}
