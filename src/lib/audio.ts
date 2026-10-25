"use client";
import {
  FALLBACK_SOUND,
  isSilent,
  isUploaded,
  toneFor,
  type Tone,
} from "./sounds";
let context: AudioContext | undefined;
function audioContext() {
  const ctor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!ctor) throw Error("Audio is unavailable");
  if (!context || context.state === "closed") context = new ctor();
  return context;
}
/** Resume the audio context from a user gesture so later alerts are allowed. */
export function unlockAlertSound() {
  try {
    void audioContext()
      .resume()
      .catch(() => {});
  } catch {}
}
async function readyContext() {
  const ctx = audioContext();
  if (ctx.state !== "running") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error("Browser blocked sound")), 300);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (ctx.state !== "running") throw Error("Browser blocked sound");
  return ctx;
}
/** Synthesises a declarative tone: each note gets a short attack and an exponential decay. */
async function playTone(tone: Tone, volume: number) {
  const ctx = await readyContext();
  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume) * 0.14;
  master.connect(ctx.destination);
  let at = ctx.currentTime + 0.01;
  let end = at;
  const nodes: AudioNode[] = [master];
  tone.notes.forEach((note, i) => {
    if (i > 0) at += (note.offsetMs ?? 0) / 1000;
    const length = note.durationMs / 1000;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = note.type;
    oscillator.frequency.value = note.freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(note.gainScale, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(at);
    oscillator.stop(at + length + 0.02);
    nodes.push(oscillator, gain);
    end = Math.max(end, at + length + 0.02);
  });
  const last = nodes[nodes.length - 2] as OscillatorNode;
  last.onended = () => nodes.forEach((n) => n.disconnect());
  return Math.round((end - ctx.currentTime) * 1000);
}
async function playUpload(path: string, volume: number) {
  const audio = new Audio("/api/sound?path=" + encodeURIComponent(path));
  audio.volume = Math.min(1, Math.max(0, volume));
  audio.preload = "auto";
  try {
    await audio.play();
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    throw Error(
      name === "NotAllowedError"
        ? "Browser blocked sound"
        : "Sound file could not be played",
    );
  }
}
/**
 * Plays an alert. `sound` is "builtin:<tone>", "none", an uploaded path, or
 * undefined for the Orbit default. Rejects with "Browser blocked sound" when
 * playback needs a user gesture first.
 */
export async function playAlertSound(
  sound: string | undefined,
  volume: number,
) {
  if (volume <= 0 || isSilent(sound)) return;
  if (isUploaded(sound)) {
    await playUpload(sound, volume);
    return;
  }
  const tone = toneFor(sound) || toneFor(FALLBACK_SOUND)!;
  await playTone(tone, volume);
}
/** Preview from the settings screens; identical playback so what you hear is what you get. */
export async function previewSound(sound: string | undefined, volume: number) {
  if (volume <= 0) throw Error("Turn the volume up to hear a preview");
  if (isSilent(sound)) return;
  await playAlertSound(sound, volume);
}
