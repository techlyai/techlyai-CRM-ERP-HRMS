import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loginIdentity } from "../src/lib/domain";
import { devAccountsAllowed } from "../src/lib/auth";

test("sign-in accepts a username or a phone number", () => {
  assert.deepEqual(loginIdentity("  SuperAdmin "), { username: "superadmin" });
  assert.deepEqual(loginIdentity("employee1"), { username: "employee1" });
  assert.equal("phone" in loginIdentity("+91 98765 43210"), true);
  assert.throws(() => loginIdentity("ab"));
  assert.throws(() => loginIdentity("bad name"));
});

test("weak development accounts are refused in production unless allowed", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { node: env.NODE_ENV, allow: env.ALLOW_DEV_ACCOUNTS };
  try {
    env.NODE_ENV = "development";
    delete env.ALLOW_DEV_ACCOUNTS;
    assert.equal(devAccountsAllowed(), true);
    env.NODE_ENV = "production";
    assert.equal(devAccountsAllowed(), false);
    env.ALLOW_DEV_ACCOUNTS = "1";
    assert.equal(devAccountsAllowed(), false);
    env.ALLOW_DEV_ACCOUNTS = "true";
    assert.equal(devAccountsAllowed(), true);
  } finally {
    env.NODE_ENV = saved.node;
    if (saved.allow === undefined) delete env.ALLOW_DEV_ACCOUNTS;
    else env.ALLOW_DEV_ACCOUNTS = saved.allow;
  }
});

test("the development account config holds no passwords and unique logins", () => {
  const text = readFileSync("scripts/dev-accounts.json", "utf8");
  assert.doesNotMatch(text, /"password"/i);
  const { accounts } = JSON.parse(text) as { accounts: { username: string; phone: string; role: string; name: string }[] };
  assert.deepEqual(accounts.map((a) => a.username), ["superadmin", "admin", "employee1", "employee2", "employee3"]);
  assert.deepEqual(accounts.map((a) => a.role), ["super_admin", "manager", "employee", "employee", "employee"]);
  assert.deepEqual(accounts.slice(2).map((a) => a.name), ["Employee 1", "Employee 2", "Employee 3"]);
  assert.equal(new Set(accounts.map((a) => a.phone)).size, accounts.length);
});
