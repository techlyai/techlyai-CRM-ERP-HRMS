import { test } from "node:test";
import assert from "node:assert/strict";
import { VPA_PATTERN, clientStatus, daysBetween, domainAllowed, dueDateFor, fillTemplate, hostOf, upiLink } from "../src/lib/mmc";
import { KEY_PLACEHOLDER, htmlSnippet, nextSnippet, nodeSnippet, phpSnippet, suspendedPage } from "../src/lib/mmc-snippets";
import { messageVars, templateKey } from "../src/lib/msg91";

test("billing day is clamped to the month end", () => {
  assert.equal(dueDateFor("2026-02-01", 31), "2026-02-28");
  assert.equal(dueDateFor("2028-02-01", 30), "2028-02-29");
  assert.equal(dueDateFor("2026-04-01", 31), "2026-04-30");
  assert.equal(dueDateFor("2026-10-01", 5), "2026-10-05");
  assert.equal(daysBetween("2026-10-05", "2026-10-12"), 7);
});

test("headline status: overdue beats pending beats paid", () => {
  assert.equal(clientStatus([{ status: "Paid" }, { status: "Overdue" }, { status: "Pending" }]), "Overdue");
  assert.equal(clientStatus([{ status: "Paid" }, { status: "Pending" }]), "Pending");
  assert.equal(clientStatus([]), "Paid");
});

test("domain matching allows the domain and its subdomains only", () => {
  assert.equal(hostOf("https://www.Ravi-Stores.in:8443/path"), "ravi-stores.in");
  assert.equal(hostOf("ravistores.in"), "ravistores.in");
  assert.equal(hostOf("not a url"), "");
  assert.ok(domainAllowed("ravistores.in", "shop.ravistores.in"));
  assert.ok(domainAllowed("ravistores.in", "www.ravistores.in"));
  assert.ok(!domainAllowed("ravistores.in", "evilravistores.in"));
  assert.ok(!domainAllowed("ravistores.in", "ravistores.in.evil.com"));
  assert.ok(domainAllowed("", "anything.com"));
});

test("templates fill known variables and blank unknown ones", () => {
  assert.equal(fillTemplate("Hi {{client_name}}, pay Rs.{{ amount }} by {{due_date}}{{nope}}", { client_name: "Ravi", amount: "500", due_date: "5 Nov" }), "Hi Ravi, pay Rs.500 by 5 Nov");
  assert.equal(templateKey({ event: "manual", vars: { template: "due_today" } }), "due_today");
  assert.equal(templateKey({ event: "suspended", vars: {} }), "suspended");
});

test("receipt links are built from APP_URL and the token", () => {
  const saved = process.env.APP_URL;
  process.env.APP_URL = "https://orbit.example/";
  try {
    assert.equal(messageVars({ vars: { receipt_token: "ab".repeat(32) } }).receipt_link, "https://orbit.example/api/mmc/receipt/" + "ab".repeat(32));
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});

test("snippets carry the key, a 5-minute cache, a 3-second timeout and fail open", () => {
  const input = {
    endpoint: "https://orbit.example/api/site-status",
    siteKey: "sk_live_" + "x".repeat(43),
    title: "Site Suspended",
    message: "Please contact <admin> & pay",
    contact: { name: "Techly", phone: "+91 90000 00000", email: "a@b.in", whatsapp: "+919000000000" },
  };
  const php = phpSnippet(input);
  assert.match(php, /'timeout' => 3/);
  assert.match(php, /> 300/);
  assert.match(php, /http_response_code\(503\)/);
  assert.match(php, /Fail open/);
  assert.ok(php.includes(input.siteKey));
  const node = nodeSnippet(input);
  assert.match(node, /AbortSignal\.timeout\(3000\)/);
  assert.match(node, /5 \* 60 \* 1000/);
  assert.match(node, /status\(503\)/);
  assert.match(htmlSnippet({ ...input, siteKey: KEY_PLACEHOLDER }), /YOUR_SITE_KEY/);
  // Server snippets read the key from the environment and never ship the placeholder as a key.
  assert.match(php, /ORBIT_SITE_KEY/);
  assert.match(node, /process\.env\.ORBIT_SITE_KEY/);
  const next = nextSnippet({ ...input, siteKey: KEY_PLACEHOLDER });
  assert.match(next, /process\.env\.ORBIT_SITE_KEY \|\| ""/);
  assert.match(next, /status: 503/);
  assert.ok(!phpSnippet({ ...input, siteKey: KEY_PLACEHOLDER }).includes(KEY_PLACEHOLDER));
  // The suspended page escapes settings text.
  const page = suspendedPage(input);
  assert.ok(page.includes("Please contact &lt;admin&gt; &amp; pay"));
  assert.ok(page.includes("https://wa.me/919000000000"));
});

test("UPI links carry payee, amount and note; pay links come from APP_URL", () => {
  const link = upiLink("techlyai@oksbi", "Techly AI", 1500, "MMC Ravi Oct 2026");
  assert.ok(link.startsWith("upi://pay?"));
  const q = new URLSearchParams(link.slice("upi://pay?".length));
  assert.equal(q.get("pa"), "techlyai@oksbi");
  assert.equal(q.get("pn"), "Techly AI");
  assert.equal(q.get("am"), "1500.00");
  assert.equal(q.get("cu"), "INR");
  assert.ok(!link.includes("+"));
  assert.equal(new URLSearchParams(upiLink("a@b", "X", 0, "").slice(10)).get("am"), null);
  assert.ok(VPA_PATTERN.test("example-1@okbank"));
  assert.ok(!VPA_PATTERN.test("not a upi"));
  const saved = process.env.APP_URL;
  process.env.APP_URL = "https://orbit.example";
  try {
    assert.equal(messageVars({ vars: { pay_token: "c".repeat(64) } }).pay_link, "https://orbit.example/pay/" + "c".repeat(64));
    assert.equal(messageVars({ vars: { website: "https://www.RaviStores.in/" } }).website, "RaviStores.in");
    assert.equal(messageVars({ vars: { website: "Ravi Stores" } }).website, "Ravi Stores");
  } finally {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  }
});
