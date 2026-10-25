import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileNotificationHead,
  readNotificationsInBatches,
} from "../src/lib/notification-state";

test("a burst reopens exhausted pagination directly after the new head without skipping its gap", () => {
  const previous = [{ id: "old", created_at: "2026-10-21T00:00:00Z" }];
  const burst = Array.from({ length: 60 }, (_, index) => ({
    id: `new-${index}`,
    created_at: "2026-10-21T01:00:00Z",
  }));
  const next = burst.slice(0, 50);
  const pagination = reconcileNotificationHead(previous, next, 50);
  assert.deepEqual(pagination, { offset: 50, exhausted: false });
  const older = [...burst, ...previous].slice(pagination!.offset);
  assert.deepEqual(older, [...burst.slice(50), ...previous]);
  assert.deepEqual(reconcileNotificationHead([], next, 50), pagination);
});

test("unchanged polls and read acknowledgements preserve pagination progress", () => {
  const previous = [
    { id: "one", created_at: "2026-10-21T00:00:00Z", read_at: null },
  ];
  const next = [{ ...previous[0], read_at: "2026-10-21T01:00:00Z" }];
  assert.equal(reconcileNotificationHead(previous, next, 50), null);
  assert.equal(reconcileNotificationHead([], [], 50), null);
});

test("resurfaced chat alerts restart pagination even when IDs are unchanged", () => {
  const previous = Array.from({ length: 50 }, (_, index) => ({
    id: String(index),
    created_at: "2026-10-21T00:00:00Z",
  }));
  const next = previous.map((row, index) =>
    index === 0 ? { ...row, created_at: "2026-10-21T01:00:00Z" } : row,
  );
  assert.deepEqual(reconcileNotificationHead(previous, next, 50), {
    offset: 50,
    exhausted: false,
  });
});

test("a short refreshed head records complete server coverage", () => {
  assert.deepEqual(
    reconcileNotificationHead(
      [],
      [{ id: "one", created_at: "2026-10-21T00:00:00Z" }],
      50,
    ),
    { offset: 1, exhausted: true },
  );
});

test("marking over 100 notifications read saves every ID within the action limit", async () => {
  const ids = Array.from({ length: 235 }, (_, i) => String(i));
  const batches: string[][] = [];
  const result = await readNotificationsInBatches(ids, async (batch) => {
    batches.push(batch);
    return { ok: true };
  });
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 100, 35],
  );
  assert.deepEqual(result, { readIds: ids });
});

test("failed read batches leave unsaved notifications unread and stop further writes", async () => {
  const ids = Array.from({ length: 250 }, (_, i) => String(i));
  let calls = 0;
  const result = await readNotificationsInBatches(ids, async () => {
    calls++;
    return calls === 1 ? { ok: true } : { ok: false, error: "Please retry" };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, {
    readIds: ids.slice(0, 100),
    error: "Please retry",
  });
});

test("read transport errors are recoverable and never acknowledge unsaved IDs", async () => {
  const result = await readNotificationsInBatches(["one"], async () => {
    throw new Error("Network failed");
  });
  assert.deepEqual(result.readIds, []);
  assert.match(result.error!, /connection.*try again/);
});

test("read batches ignore duplicates and skip empty selections", async () => {
  const batches: string[][] = [];
  const save = async (batch: string[]) => {
    batches.push(batch);
    return { ok: true };
  };
  assert.deepEqual(await readNotificationsInBatches([], save), { readIds: [] });
  assert.deepEqual(
    await readNotificationsInBatches(["one", "one", "two"], save),
    { readIds: ["one", "two"] },
  );
  assert.deepEqual(batches, [["one", "two"]]);
});
