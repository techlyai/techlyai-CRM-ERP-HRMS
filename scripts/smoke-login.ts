import assert from "node:assert/strict";
import { revokeSession, sessionProfile } from "../src/lib/auth";
import { pool, transaction } from "../src/lib/postgres";

async function main() {
  const password = process.env.TECHLY_TEST_PASSWORD;
  const phone = process.env.TECHLY_TEST_PHONE;
  const action = process.env.TECHLY_LOGIN_ACTION;
  if (!password || !phone || !action) throw Error("Set test phone/password and the current built login action ID.");
  const origin = "http://127.0.0.1:3000";
  const page = await fetch(origin + "/login");
  assert.equal(page.status, 200);
  assert.ok(!(await page.text()).includes("Database connection required"));
  const response = await fetch(origin + "/login", {
    method: "POST",
    headers: { Origin: origin, "Next-Action": action, "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify([{ phone, password }]),
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  const result = await response.text();
  assert.ok(result.includes('"ok":true'), "Login action failed: " + result.slice(0, 500));
  const cookie = response.headers.getSetCookie().find(value => value.startsWith("techly-session="));
  assert.ok(cookie, "Login did not issue a session cookie");
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=lax/i);
  const token = cookie.split(";")[0].slice("techly-session=".length);
  try {
    const profile = await transaction(c => sessionProfile(c, token));
    assert.equal(profile?.role, "super_admin");
    assert.equal(profile?.must_change_password, true);
    const dashboard = await fetch(origin + "/", { headers: { Cookie: "techly-session=" + token }, redirect: "manual" });
    assert.equal(dashboard.status, 307);
    assert.equal(dashboard.headers.get("location"), "/change-password");
    const change = await fetch(origin + "/change-password", { headers: { Cookie: "techly-session=" + token } });
    assert.equal(change.status, 200);
    assert.ok((await change.text()).includes("Set password"));
    console.log("Verified actual HTTP sign-in, Super Admin role, HttpOnly session, and required first-password-change page.");
  } finally { await revokeSession(token); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool().end());
