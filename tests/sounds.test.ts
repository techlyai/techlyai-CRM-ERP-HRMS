import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtinTones,
  soundLibrary,
  resolveSound,
  labelSound,
  isBuiltin,
  isUploaded,
  isSilent,
  isValidSound,
  toneFor,
  describeSource,
  FALLBACK_SOUND,
  SILENT_SOUND,
} from "../src/lib/sounds";
import type { Preferences, CompanySounds } from "../src/lib/notification-types";

const upload = "11111111-2222-4333-8444-555555555555/sounds/66666666-7777-4888-9999-000000000000.mp3";
const company: CompanySounds = {
  default: "builtin:bell",
  categories: { chat: "builtin:ping", eod: upload },
};
const prefs = (over: Partial<Preferences> = {}): Preferences => ({
  muted: false,
  volume: 0.5,
  categories: {},
  ...over,
});

test("tone library has at least six synthesisable tones plus a silent option", () => {
  assert.ok(builtinTones.length >= 6);
  const keys = builtinTones.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length, "tone keys are unique");
  for (const name of ["chime", "ping", "bell", "pulse", "soft", "alert"])
    assert.ok(keys.includes(name), name + " exists");
  for (const tone of builtinTones) {
    assert.ok(tone.label && tone.description);
    assert.ok(tone.notes.length >= 1);
    for (const note of tone.notes) {
      assert.ok(note.freq >= 100 && note.freq <= 5000, tone.key + " frequency is audible");
      assert.ok(note.durationMs >= 50 && note.durationMs <= 2000, tone.key + " duration is short");
      assert.ok(note.gainScale > 0 && note.gainScale <= 1, tone.key + " gain is bounded");
      assert.ok(["sine", "triangle", "square", "sawtooth"].includes(note.type));
      assert.ok((note.offsetMs ?? 0) >= 0);
    }
  }
  assert.equal(soundLibrary[soundLibrary.length - 1].value, SILENT_SOUND);
  assert.equal(soundLibrary.length, builtinTones.length + 1);
  assert.equal(toneFor("builtin:chime")?.key, "chime");
  assert.equal(toneFor("builtin:missing"), undefined);
  assert.equal(toneFor(upload), undefined);
});

test("sound values are classified as built-in, uploaded or silent", () => {
  assert.ok(isBuiltin("builtin:chime"));
  assert.ok(!isBuiltin(upload));
  assert.ok(isUploaded(upload));
  assert.ok(!isUploaded("builtin:chime"));
  assert.ok(!isUploaded(SILENT_SOUND));
  assert.ok(isSilent("none"));
  assert.ok(isValidSound("builtin:pulse"));
  assert.ok(isValidSound(upload));
  assert.ok(isValidSound("none"));
  assert.ok(!isValidSound("builtin:nope"));
  assert.ok(!isValidSound("../etc/passwd"));
  assert.ok(!isValidSound(""));
  assert.ok(!isValidSound(42));
});

test("labels describe stored values for people", () => {
  assert.equal(labelSound("builtin:bell"), "Bell");
  assert.equal(labelSound("none"), "None");
  assert.equal(labelSound(undefined), "Default");
  assert.equal(labelSound(undefined, "Company default"), "Company default");
  assert.equal(labelSound("builtin:unknown"), "Unknown tone");
  assert.match(labelSound(upload), /^Custom upload/);
  assert.equal(describeSource("fallback"), "Orbit default");
});

test("resolveSound follows user category > user default > company category > company default > chime", () => {
  // Everything set: the user's category override wins.
  const full = resolveSound(
    "chat",
    prefs({ default_sound: "builtin:soft", categories: { chat: { sound: "builtin:alert" } } }),
    company,
  );
  assert.deepEqual([full.sound, full.source, full.muted], ["builtin:alert", "user-category", false]);
  // No category override: the user's default beats the company's category choice.
  const userDefault = resolveSound("chat", prefs({ default_sound: "builtin:soft" }), company);
  assert.deepEqual([userDefault.sound, userDefault.source], ["builtin:soft", "user-default"]);
  // No user choice at all: company category, then company default.
  const companyCat = resolveSound("eod", prefs(), company);
  assert.deepEqual([companyCat.sound, companyCat.source], [upload, "company-category"]);
  const companyDefault = resolveSound("tasks", prefs(), company);
  assert.deepEqual([companyDefault.sound, companyDefault.source], ["builtin:bell", "company-default"]);
  // Nothing configured anywhere: Orbit chime.
  const fallback = resolveSound("tasks", prefs(), { default: "", categories: {} });
  assert.deepEqual([fallback.sound, fallback.source], [FALLBACK_SOUND, "fallback"]);
  assert.equal(resolveSound("tasks", undefined, undefined).sound, FALLBACK_SOUND);
  // Invalid stored values are skipped rather than played.
  const invalid = resolveSound("tasks", prefs({ default_sound: "builtin:ghost" }), company);
  assert.deepEqual([invalid.sound, invalid.source], ["builtin:bell", "company-default"]);
});

test("resolveSound reports muting from master mute, category mute, snooze and silent choices", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  assert.deepEqual(
    pick(resolveSound("chat", prefs({ muted: true }), company)),
    { muted: true, reason: "all-muted" },
  );
  assert.deepEqual(
    pick(resolveSound("chat", prefs({ categories: { chat: { muted: true } } }), company)),
    { muted: true, reason: "category-muted" },
  );
  assert.deepEqual(
    pick(resolveSound("chat", prefs({ snoozed_until: "2026-10-13T11:00:00Z" }), company, now)),
    { muted: true, reason: "snoozed" },
  );
  assert.deepEqual(
    pick(resolveSound("chat", prefs({ snoozed_until: "2026-10-13T09:00:00Z" }), company, now)),
    { muted: false, reason: undefined },
  );
  const silent = resolveSound("chat", prefs({ categories: { chat: { sound: "none" } } }), company);
  assert.deepEqual([silent.sound, silent.muted, silent.reason], ["none", true, "silent"]);
  // A muted category still resolves the sound it would otherwise use (for the settings preview).
  const mutedCat = resolveSound("eod", prefs({ categories: { eod: { muted: true } } }), company);
  assert.equal(mutedCat.sound, upload);
});

function pick(r: ReturnType<typeof resolveSound>) {
  return { muted: r.muted, reason: r.reason };
}
