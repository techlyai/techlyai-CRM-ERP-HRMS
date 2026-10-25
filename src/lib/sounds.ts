// Built-in alert tone library and sound resolution rules.
// Pure module: no browser or database access, so it is shared by the Web Audio
// player (src/lib/audio.ts), the settings screens and unit tests.
import type { Preferences, CompanySounds } from "./notification-types";

export const BUILTIN_PREFIX = "builtin:";
/** Sentinel for "play nothing" (stored as the literal string "none"). */
export const SILENT_SOUND = "none";
/** Final fallback when neither the user nor the company chose a sound. */
export const FALLBACK_SOUND = BUILTIN_PREFIX + "chime";

export type ToneWave = "sine" | "triangle" | "square" | "sawtooth";
export type ToneNote = {
  /** Oscillator frequency in Hz. */
  freq: number;
  /** Audible length of the note. */
  durationMs: number;
  /** Oscillator waveform. */
  type: ToneWave;
  /** Relative loudness, 0–1, multiplied by the master volume. */
  gainScale: number;
  /** Start offset from the previous note's start (0 = play together). */
  offsetMs?: number;
};
export type Tone = {
  key: string;
  label: string;
  description: string;
  notes: ToneNote[];
};

/** Declarative tone definitions synthesised on the client with Web Audio. */
export const builtinTones: Tone[] = [
  {
    key: "chime",
    label: "Chime",
    description: "Two bright notes. The Orbit default.",
    notes: [
      { freq: 659.25, durationMs: 180, type: "sine", gainScale: 0.9 },
      { freq: 987.77, durationMs: 320, type: "sine", gainScale: 0.8, offsetMs: 140 },
    ],
  },
  {
    key: "ping",
    label: "Ping",
    description: "A single short, clear note.",
    notes: [{ freq: 1174.66, durationMs: 220, type: "sine", gainScale: 0.85 }],
  },
  {
    key: "bell",
    label: "Bell",
    description: "A warm, ringing bell with a long tail.",
    notes: [
      { freq: 523.25, durationMs: 900, type: "triangle", gainScale: 0.75 },
      { freq: 1046.5, durationMs: 700, type: "sine", gainScale: 0.35, offsetMs: 0 },
      { freq: 1567.98, durationMs: 450, type: "sine", gainScale: 0.18, offsetMs: 0 },
    ],
  },
  {
    key: "pulse",
    label: "Pulse",
    description: "Three quick, even beats.",
    notes: [
      { freq: 783.99, durationMs: 110, type: "square", gainScale: 0.35 },
      { freq: 783.99, durationMs: 110, type: "square", gainScale: 0.35, offsetMs: 170 },
      { freq: 783.99, durationMs: 110, type: "square", gainScale: 0.35, offsetMs: 170 },
    ],
  },
  {
    key: "soft",
    label: "Soft",
    description: "A gentle, low tone for quiet rooms.",
    notes: [
      { freq: 392, durationMs: 420, type: "sine", gainScale: 0.55 },
      { freq: 493.88, durationMs: 420, type: "sine", gainScale: 0.4, offsetMs: 60 },
    ],
  },
  {
    key: "alert",
    label: "Alert",
    description: "A rising two-note signal that stands out.",
    notes: [
      { freq: 659.25, durationMs: 160, type: "sawtooth", gainScale: 0.3 },
      { freq: 880, durationMs: 160, type: "sawtooth", gainScale: 0.3, offsetMs: 180 },
      { freq: 1318.51, durationMs: 300, type: "triangle", gainScale: 0.6, offsetMs: 180 },
    ],
  },
];

const toneMap = new Map(builtinTones.map((t) => [t.key, t]));

/** Built-in keys in the order they are offered, followed by "none". */
export const soundLibrary: { value: string; label: string; description: string }[] = [
  ...builtinTones.map((t) => ({
    value: BUILTIN_PREFIX + t.key,
    label: t.label,
    description: t.description,
  })),
  { value: SILENT_SOUND, label: "None", description: "Show the alert silently." },
];

export const isBuiltin = (sound: string | undefined | null): sound is string =>
  typeof sound === "string" && sound.startsWith(BUILTIN_PREFIX);
export const isSilent = (sound: string | undefined | null) =>
  sound === SILENT_SOUND;
/** Uploaded sounds are stored as "<user>/sounds/<file>" paths served by /api/sound. */
export const isUploaded = (sound: string | undefined | null): sound is string =>
  typeof sound === "string" &&
  sound.length > 0 &&
  !isBuiltin(sound) &&
  !isSilent(sound);

/** The tone definition for a "builtin:<key>" value, or undefined for anything else. */
export function toneFor(sound: string | undefined | null): Tone | undefined {
  if (!isBuiltin(sound)) return undefined;
  return toneMap.get(sound.slice(BUILTIN_PREFIX.length));
}

/** True for a value the settings screens can store. */
export function isValidSound(sound: unknown): sound is string {
  if (typeof sound !== "string" || !sound || sound.length > 1000) return false;
  if (isSilent(sound)) return true;
  if (isBuiltin(sound)) return toneMap.has(sound.slice(BUILTIN_PREFIX.length));
  return /^[0-9a-f-]{36}\/sounds\/[0-9a-f-]{36}\.(mp3|wav)$/i.test(sound);
}

/** Human label for a stored sound value. */
export function labelSound(
  sound: string | undefined | null,
  fallback = "Default",
): string {
  if (!sound) return fallback;
  if (isSilent(sound)) return "None";
  const tone = toneFor(sound);
  if (tone) return tone.label;
  if (sound.startsWith(BUILTIN_PREFIX)) return "Unknown tone";
  const file = sound.split("/").pop() || sound;
  return "Custom upload (" + file.slice(0, 8) + "…)";
}

export type ResolvedSound = {
  /** Sound to play: "builtin:<tone>", "none", or an upload path. */
  sound: string;
  /** True when nothing should play (muted, snoozed, or the sound is "none"). */
  muted: boolean;
  /** Where the sound came from, for settings screens and tests. */
  source:
    | "user-category"
    | "user-default"
    | "company-category"
    | "company-default"
    | "fallback";
  /** Why playback is muted, when it is. */
  reason?: "all-muted" | "category-muted" | "snoozed" | "silent";
};

/**
 * Chooses the sound for a notification category.
 * Precedence: user category override → user default → company category default
 * → company default → builtin:chime.
 */
export function resolveSound(
  category: string,
  prefs: Partial<Preferences> | null | undefined,
  companySounds: Partial<CompanySounds> | null | undefined,
  now: Date = new Date(),
): ResolvedSound {
  const cat = prefs?.categories?.[category];
  let sound: string;
  let source: ResolvedSound["source"];
  if (isValidSound(cat?.sound)) {
    sound = cat!.sound!;
    source = "user-category";
  } else if (isValidSound(prefs?.default_sound)) {
    sound = prefs!.default_sound!;
    source = "user-default";
  } else if (isValidSound(companySounds?.categories?.[category])) {
    sound = companySounds!.categories![category];
    source = "company-category";
  } else if (isValidSound(companySounds?.default)) {
    sound = companySounds!.default!;
    source = "company-default";
  } else {
    sound = FALLBACK_SOUND;
    source = "fallback";
  }
  let reason: ResolvedSound["reason"];
  if (prefs?.muted) reason = "all-muted";
  else if (cat?.muted) reason = "category-muted";
  else if (
    prefs?.snoozed_until &&
    !Number.isNaN(Date.parse(prefs.snoozed_until)) &&
    new Date(prefs.snoozed_until) > now
  )
    reason = "snoozed";
  else if (isSilent(sound)) reason = "silent";
  return { sound, source, muted: Boolean(reason), reason };
}

/** Short explanation of where a category's sound currently comes from. */
export function describeSource(source: ResolvedSound["source"]) {
  return {
    "user-category": "Your choice for this category",
    "user-default": "Your default sound",
    "company-category": "Company default for this category",
    "company-default": "Company default",
    fallback: "Orbit default",
  }[source];
}
