"use client";
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
export function unlockAlertSound() {
  try {
    void audioContext()
      .resume()
      .catch(() => {});
  } catch {}
}
export async function playAlertSound(
  sound: string | undefined,
  volume: number,
) {
  if (volume <= 0) return;
  if (sound) {
    const audio = new Audio("/api/sound?path=" + encodeURIComponent(sound));
    audio.volume = Math.min(1, volume);
    await audio.play();
    return;
  }
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
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(
    Math.min(volume, 1) * 0.08,
    ctx.currentTime + 0.02,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.27);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
