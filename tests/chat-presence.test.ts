import { test } from "node:test";
import assert from "node:assert/strict";
import { loadChatPresence, type PresenceRow } from "../src/lib/chat-presence";
import { selectQuery } from "../src/lib/query";

test("chat groups with more than 100 members load every presence within query limits", async () => {
  const ids = Array.from(
    { length: 501 },
    (_, index) => "00000000-0000-4000-8000-" + String(index).padStart(12, "0"),
  );
  const batches: string[][] = [];
  const presence = await loadChatPresence(
    {
      select: async <T>(table: string, filter?: string): Promise<T[]> => {
        assert.equal(table, "presence");
        // Exercise the same filter parser used in the database path. It rejects
        // any unchunked list above 100 values, reproducing the original failure.
        const query = selectQuery(table, filter || "");
        const members = query.values.slice(0, -2) as string[];
        batches.push(members);
        return members.map(
          (id) =>
            ({
              user_id: id,
              last_seen_at: "2026-10-21T09:00:00.000Z",
              typing_conversation: null,
              typing_at: null,
            }) satisfies PresenceRow,
        ) as T[];
      },
    },
    ids,
  );
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 100, 100, 100, 100, 1],
  );
  assert.deepEqual(
    presence.map((row) => row.user_id),
    ids,
  );
});

test("empty conversations avoid presence queries and duplicate member IDs are queried once", async () => {
  let calls = 0;
  const db = {
    select: async <T>(table: string, filter?: string): Promise<T[]> => {
      calls++;
      const query = selectQuery(table, filter || "");
      assert.deepEqual(query.values.slice(0, -2), ["member"]);
      return [];
    },
  };
  assert.deepEqual(await loadChatPresence(db, []), []);
  assert.equal(calls, 0);
  await loadChatPresence(db, ["member", "member"]);
  assert.equal(calls, 1);
});
