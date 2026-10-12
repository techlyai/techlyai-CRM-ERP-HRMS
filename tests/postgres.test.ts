import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, tokenHash } from "../src/lib/passwords";
import { selectQuery } from "../src/lib/query";
import { fileResponse } from "../src/lib/file-response";
import { NextRequest } from "next/server";

test("passwords use individual salts and reject wrong or malformed credentials", async () => {
  const password = "A-long-unique-passphrase-91!";
  const [a, b] = await Promise.all([
    hashPassword(password),
    hashPassword(password),
  ]);
  assert.notEqual(a, b);
  assert.ok(await verifyPassword(password, a));
  assert.equal(await verifyPassword("incorrect", a), false);
  assert.equal(await verifyPassword(password, "plain:" + password), false);
  assert.equal(await verifyPassword(password, "scrypt:bad:00"), false);
  assert.equal(tokenHash("session").length, 64);
});
test("record search binds hostile text as data", () => {
  const hostile = "x' OR true; DROP TABLE public.records;--";
  const query = selectQuery(
    "records",
    "select=id,title&title=eq." + encodeURIComponent(hostile),
  );
  assert.ok(!query.text.includes(hostile));
  assert.deepEqual(query.values, [hostile, 1000, 0]);
  assert.match(query.text, /"title" = \$1/);
});
test("date bounds and multiple status filters are retained", () => {
  const query = selectQuery(
    "records",
    "select=*&status=neq.Archived&status=eq.Submitted&data->>date=gte.2026-10-01&data->>date=lte.2026-10-31&order=updated_at.desc&limit=31&offset=30",
  );
  assert.deepEqual(query.values, [
    "Archived",
    "Submitted",
    "2026-10-01",
    "2026-10-31",
    31,
    30,
  ]);
  assert.match(query.text, /"data"->>'date' >= \$3/);
});
test("private tables and SQL identifier/operator injection are rejected", () => {
  for (const [table, query] of [
    ["private.accounts", "select=*"],
    ["records", "select=id;delete"],
    ["records", "order=id.desc;drop"],
    ["records", "title=sql.true"],
    ["records", "limit=1000000"],
    ["records", "offset=-1"],
    ["records", "data->>x';drop=eq.test"],
  ])
    assert.throws(() => selectQuery(table, query));
});
test("list filters and null checks remain parameterized", () => {
  const query = selectQuery(
    "notifications",
    "select=id&read_at=is.null&category=in.(eod,attendance)&order=created_at.desc",
  );
  assert.match(query.text, /"read_at" is null/);
  assert.deepEqual(query.values, ["eod", "attendance", 1000, 0]);
});
test("private file responses support ranges and reject invalid bounds", async () => {
  const file = {
    name: "hello.csv",
    mime: "text/csv",
    content: Buffer.from("0123456789"),
  };
  const response = fileResponse(
    new NextRequest("http://localhost/api/files/id", {
      headers: { range: "bytes=2-5" },
    }),
    file,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(
    fileResponse(
      new NextRequest("http://localhost", { headers: { range: "bytes=99-" } }),
      file,
    ).status,
    416,
  );
  assert.equal(
    fileResponse(
      new NextRequest("http://localhost", {
        headers: { range: "bytes=0-1,8-9" },
      }),
      file,
    ).status,
    416,
  );
});
