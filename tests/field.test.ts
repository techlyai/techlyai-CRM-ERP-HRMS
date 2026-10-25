import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeQueue, needsReview, photoVerification, routeLength, sessionState, verificationInfo, type OverviewRow } from "../src/lib/field";
import { fieldParams } from "../src/lib/field-params";
import { validateFile } from "../src/lib/files";

test("route length skips imprecise points", () => {
  const p = (lat: number, acc = 10) => ({ latitude: lat, longitude: 77.5946, accuracy_m: acc });
  // 0.001° of latitude is about 111 m.
  assert.ok(Math.abs(routeLength([p(12.97), p(12.971), p(12.972)]) - 222.4) < 1);
  assert.ok(Math.abs(routeLength([p(12.97), p(13.5, 900), p(12.971)]) - 111.2) < 1);
  assert.equal(routeLength([p(12.97)]), 0);
});

test("offline queue keeps each point once and caps its size", () => {
  const pt = (id: string) => ({ client_id: id, lat: 1, lng: 1, accuracy: 5, captured_at: "2026-10-25T10:00:00Z", source: "track" as const });
  assert.deepEqual(mergeQueue([pt("a")], [pt("a"), pt("b")]).map((p) => p.client_id), ["a", "b"]);
  assert.deepEqual(mergeQueue([pt("a"), pt("b")], [pt("c")], 2).map((p) => p.client_id), ["b", "c"]);
});

test("photo status: unfinished uploads are pending and only unverified photos need review", () => {
  assert.equal(photoVerification({ verification: "verified", file_path: null }), "pending");
  assert.equal(photoVerification({ verification: "outside", file_path: "x" }), "outside");
  assert.equal(needsReview({ verification: "verified", file_path: "x", review_status: "pending" }), false);
  assert.equal(needsReview({ verification: "manual_review", file_path: "x", review_status: "pending" }), true);
  assert.equal(needsReview({ verification: "outside", file_path: "x", review_status: "approved" }), false);
  // Every status has a readable label, so colour is never the only signal.
  for (const v of Object.values(verificationInfo)) assert.ok(v.label.length > 5);
  assert.equal(verificationInfo.outside.label, "Failed – Outside Geofence");
});

test("session state for the overview", () => {
  const row = (sessions: { status: "active" | "ended" }[]) => ({ sessions } as unknown as OverviewRow);
  assert.equal(sessionState(row([])), "not_started");
  assert.equal(sessionState(row([{ status: "ended" }])), "completed");
  assert.equal(sessionState(row([{ status: "ended" }, { status: "active" }])), "active");
});

test("list filters ignore anything unexpected", () => {
  const p = fieldParams({ from: "2026-10-30", to: "2026-10-25", user: "not-a-uuid", verification: "hacked", source: "camera" }, "2026-10-25");
  assert.equal(p.from, "2026-10-25");
  assert.equal(p.user, undefined);
  assert.equal(p.verification, undefined);
  assert.equal(p.source, "camera");
  assert.equal(fieldParams({}, "2026-10-25").from, "2026-10-19");
});

test("field photos must be images", () => {
  assert.throws(() => validateFile("site.pdf", "application/pdf", 100, false, "field_photo"), /JPG, PNG or WebP/);
  assert.doesNotThrow(() => validateFile("site.jpg", "image/jpeg", 100, false, "field_photo"));
  assert.doesNotThrow(() => validateFile("notes.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 100, false, "field_report"));
});
