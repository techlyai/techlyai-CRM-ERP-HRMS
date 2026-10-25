import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import * as postgres from "../src/lib/postgres";
import { tokenHash } from "../src/lib/passwords";
import { activationUrl, inviteStatus } from "../src/lib/invites";

test("malformed activation links are rejected without querying the database", async (context) => {
  const database = context.mock.method(postgres, "transaction", () => {
    throw Error("The database must not be accessed for malformed tokens");
  });
  for (const token of [
    "",
    "a".repeat(63),
    "a".repeat(65),
    "G".repeat(64),
    "<script>",
  ])
    assert.deepEqual(await inviteStatus(token), { state: "invalid" });
  assert.equal(database.mock.callCount(), 0);
});

test("activation link validation distinguishes valid, expired, used and inactive accounts", async (context) => {
  const token = "a".repeat(64);
  const cases = [
    { row: null, state: "invalid" },
    {
      row: {
        full_name: "Invitee",
        active: true,
        used_at: null,
        expired: false,
      },
      state: "valid",
    },
    {
      row: { full_name: "Invitee", active: true, used_at: null, expired: true },
      state: "expired",
    },
    {
      row: {
        full_name: "Invitee",
        active: true,
        used_at: "2026-01-01",
        expired: false,
      },
      state: "used",
    },
    {
      row: {
        full_name: "Invitee",
        active: false,
        used_at: null,
        expired: false,
      },
      state: "inactive",
    },
  ] as const;
  let row: unknown = null;
  const calls: string[] = [];
  context.mock.method(
    postgres,
    "transaction",
    async (callback: (client: PoolClient) => Promise<unknown>) =>
      callback({
        query: async (sql: string, values: unknown[]) => {
          calls.push(sql);
          assert.match(sql, /^select /i);
          assert.deepEqual(
            values,
            [tokenHash(token)],
            "only the token digest reaches the database",
          );
          return { rows: row ? [row] : [] };
        },
      } as unknown as PoolClient),
  );
  for (const item of cases) {
    row = item.row;
    const result = await inviteStatus(token);
    assert.equal(result.state, item.state);
    assert.equal(result.name, item.row ? "Invitee" : undefined);
  }
  assert.equal(calls.length, cases.length);
});

test("an activation lookup connection failure is not misreported as an invalid link", async (context) => {
  context.mock.method(postgres, "transaction", async () => {
    throw Error("Connection unavailable");
  });
  await assert.rejects(inviteStatus("a".repeat(64)), /Connection unavailable/);
});

test("welcome URLs point to the activation page without a double slash", () => {
  const previous = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://workspace.example.test/";
    const url = new URL(activationUrl("a".repeat(64)));
    assert.equal(url.pathname, "/activate");
    assert.equal(url.searchParams.get("token"), "a".repeat(64));
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
