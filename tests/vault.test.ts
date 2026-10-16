import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealPassword, openPassword, vaultConfigured } from "../src/lib/vault";
import { filterCredentials, versionAt, safeUrl, type Credential } from "../src/lib/credentials";

const key = randomBytes(32).toString("base64");
const id = "7d1b2c38-1d7e-4a39-a1c5-3f1f6a4e2b10";
function withKey<T>(k: string | undefined, fn: () => T, previous?: string) {
  const saved = [process.env.CREDENTIALS_ENCRYPTION_KEY, process.env.CREDENTIALS_PREVIOUS_KEYS];
  if (k === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CREDENTIALS_ENCRYPTION_KEY = k;
  if (previous === undefined) delete process.env.CREDENTIALS_PREVIOUS_KEYS;
  else process.env.CREDENTIALS_PREVIOUS_KEYS = previous;
  try {
    return fn();
  } finally {
    process.env.CREDENTIALS_ENCRYPTION_KEY = saved[0];
    process.env.CREDENTIALS_PREVIOUS_KEYS = saved[1];
    if (saved[0] === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    if (saved[1] === undefined) delete process.env.CREDENTIALS_PREVIOUS_KEYS;
  }
}

test("credential passwords round-trip with AES-256-GCM and never store plaintext", () => {
  withKey(key, () => {
    const secret = "S3cure!pässwörd ✓";
    const sealed = sealPassword(secret, id, 1);
    assert.ok(!Buffer.from(sealed.ciphertext, "base64").toString("utf8").includes("S3cure"));
    assert.equal(Buffer.from(sealed.iv, "base64").length, 12);
    assert.equal(Buffer.from(sealed.tag, "base64").length, 16);
    assert.equal(openPassword(sealed, id, 1), secret);
    // A fresh IV makes repeated encryptions differ.
    assert.notEqual(sealPassword(secret, id, 1).ciphertext, sealed.ciphertext);
  });
});

test("ciphertext is bound to its credential and version", () => {
  withKey(key, () => {
    const sealed = sealPassword("hunter2", id, 3);
    assert.throws(() => openPassword(sealed, id, 2), /could not be decrypted/);
    assert.throws(() => openPassword(sealed, "00000000-0000-0000-0000-000000000000", 3), /could not be decrypted/);
    const tampered = { ...sealed, tag: Buffer.alloc(16).toString("base64") };
    assert.throws(() => openPassword(tampered, id, 3), /could not be decrypted/);
  });
});

test("rotated keys still decrypt older passwords; missing keys fail closed", () => {
  const sealed = withKey(key, () => sealPassword("old-secret", id, 1));
  const next = randomBytes(32).toString("hex");
  withKey(next, () => assert.equal(openPassword(sealed, id, 1), "old-secret"), key);
  withKey(next, () => assert.throws(() => openPassword(sealed, id, 1), /no longer configured/));
  withKey(undefined, () => {
    assert.equal(vaultConfigured(), false);
    assert.throws(() => sealPassword("x", id, 1), /CREDENTIALS_ENCRYPTION_KEY/);
  });
  withKey("too-short", () => assert.equal(vaultConfigured(), false));
});

const row = (over: Partial<Credential>): Credential => ({
  id: over.id || id,
  client_id: "c",
  service_name: "Service",
  category: "Other",
  login_url: null,
  username: null,
  account_id: null,
  project_id: null,
  purpose: "",
  notes: "",
  current_version: 1,
  password_changed_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "u",
  updated_at: "2026-01-01T00:00:00Z",
  updated_by: "u",
  archived_at: null,
  archived_by: null,
  row_version: 1,
  ...over,
});

test("credential search, filters, archive separation and sorting", () => {
  const list = [
    row({ id: "1", service_name: "wordpress", category: "WordPress", username: "editor", updated_at: "2026-03-01T00:00:00Z" }),
    row({ id: "2", service_name: "Hosting", category: "Hosting", account_id: "acct-77", updated_at: "2026-05-01T00:00:00Z" }),
    row({ id: "3", service_name: "Old email", category: "Business Email", archived_at: "2026-02-01T00:00:00Z" }),
  ];
  assert.deepEqual(filterCredentials(list, {}).map((c) => c.id), ["2", "1"]);
  assert.deepEqual(filterCredentials(list, { archived: true }).map((c) => c.id), ["3"]);
  assert.deepEqual(filterCredentials(list, { query: "EDIT" }).map((c) => c.id), ["1"]);
  assert.deepEqual(filterCredentials(list, { query: "acct-77" }).map((c) => c.id), ["2"]);
  assert.deepEqual(filterCredentials(list, { category: "WordPress" }).map((c) => c.id), ["1"]);
  assert.deepEqual(filterCredentials(list, { sort: "updated" }).map((c) => c.id), ["2", "1"]);
});

test("finds the password version that was in use at a given time", () => {
  const versions = [
    { version: 3, created_at: "2026-10-16T05:00:00Z", replaced_at: null },
    { version: 2, created_at: "2026-09-20T05:00:00Z", replaced_at: "2026-10-16T05:00:00Z" },
    { version: 1, created_at: "2026-08-10T05:00:00Z", replaced_at: "2026-09-20T05:00:00Z" },
  ];
  assert.equal(versionAt(versions, new Date("2026-09-01T00:00:00Z"))?.version, 1);
  assert.equal(versionAt(versions, new Date("2026-09-20T05:00:00Z"))?.version, 2);
  assert.equal(versionAt(versions, new Date("2026-12-01T00:00:00Z"))?.version, 3);
  assert.equal(versionAt(versions, new Date("2026-01-01T00:00:00Z")), null);
});

test("only http and https login URLs are opened", () => {
  assert.equal(safeUrl("https://example.com/admin"), "https://example.com/admin");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.equal(safeUrl(null), null);
});
