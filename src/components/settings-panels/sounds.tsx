"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Volume2,
  VolumeX,
  Upload,
  Play,
  RotateCcw,
  BellOff,
  Building2,
  Check,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import type { Profile } from "@/lib/modules";
import {
  notificationCategories,
  type Preferences,
  type CompanySounds,
} from "@/lib/notification-types";
import type { CompanySettings } from "@/components/settings";
import { savePreferences, saveSettings } from "@/lib/actions";
import { uploadFile } from "@/components/attachments";
import { previewSound, unlockAlertSound } from "@/lib/audio";
import {
  soundLibrary,
  labelSound,
  resolveSound,
  describeSource,
  isUploaded,
  isValidSound,
  FALLBACK_SOUND,
  SILENT_SOUND,
} from "@/lib/sounds";
import { Button } from "@/components/ui/button";

const groups = Array.from(new Set(notificationCategories.map((c) => c.group)));
const groupHints: Record<string, string> = {
  Reminders: "Scheduled reminders you own or were assigned.",
  Team: "Direct and group chat messages.",
  Reports: "Daily report submissions, questions and decisions.",
  Business: "Renewals, vendor payments and lead follow-ups.",
  Work: "Tasks, projects and attendance.",
  Operations: "Asset maintenance, stock levels and MMC client sites.",
};
function cleanPreferences(p: Preferences): Preferences {
  const categories: Preferences["categories"] = {};
  for (const [key, value] of Object.entries(p.categories || {})) {
    const entry: { muted?: boolean; sound?: string } = {};
    if (value?.muted) entry.muted = true;
    if (isValidSound(value?.sound)) entry.sound = value.sound;
    if (Object.keys(entry).length) categories[key] = entry;
  }
  const out: Preferences = {
    muted: Boolean(p.muted),
    volume: Math.min(1, Math.max(0, Math.round(p.volume * 100) / 100)),
    categories,
  };
  if (isValidSound(p.default_sound)) out.default_sound = p.default_sound;
  if (p.snoozed_until && !Number.isNaN(Date.parse(p.snoozed_until)))
    out.snoozed_until = new Date(p.snoozed_until).toISOString();
  return out;
}
function toLocalInput(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${checked ? "border-primary bg-primary" : "border-border bg-muted"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}
function PreviewButton({
  onClick,
  label,
  busy,
}: {
  onClick: () => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Play size={14} />
      )}
    </button>
  );
}
export function SoundSettings({
  profile,
  preferences,
  companySounds,
  settings,
  onPreferencesSaved,
  onCompanySaved,
}: {
  profile: Profile;
  preferences: Preferences;
  companySounds: CompanySounds;
  /** Full company settings; needed for admins to save company-wide defaults. */
  settings?: CompanySettings;
  onPreferencesSaved?: (preferences: Preferences) => void;
  onCompanySaved?: (settings: CompanySettings) => void;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(() => ({
    ...preferences,
    muted: Boolean(preferences.muted),
    volume: typeof preferences.volume === "number" ? preferences.volume : 0.5,
    categories: { ...(preferences.categories || {}) },
  }));
  const [company, setCompany] = useState<CompanySounds>({
    default: companySounds?.default || FALLBACK_SOUND,
    categories: { ...(companySounds?.categories || {}) },
  });
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState("");
  const [playing, setPlaying] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();
  const admin = profile.role === "super_admin";
  const effectiveCompany = settings?.sounds || companySounds;
  const userDefault = resolveSound("", prefs, effectiveCompany);
  const customLabel = (sound: string) =>
    names[sound] ? `Custom · ${names[sound]}` : labelSound(sound);

  async function preview(sound: string | undefined, key: string) {
    setError("");
    setPlaying(key);
    try {
      unlockAlertSound();
      await previewSound(sound, prefs.volume);
      setBlocked(false);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Preview failed";
      if (text.includes("blocked")) setBlocked(true);
      else setError(text);
    } finally {
      setTimeout(() => setPlaying(""), 250);
    }
  }
  function schedulePreview() {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(
      () => preview(userDefault.sound, "volume"),
      150,
    );
  }
  async function upload(
    file: File | undefined,
    apply: (path: string) => void,
    key: string,
  ) {
    if (!file) return;
    setError("");
    setUploading(key);
    try {
      const path = await uploadFile(undefined, file, true);
      setNames((n) => ({ ...n, [path]: file.name }));
      apply(path);
      setMessage(`"${file.name}" uploaded. Save to apply it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading("");
    }
  }
  function setCategory(
    key: string,
    patch: { muted?: boolean; sound?: string | null },
  ) {
    setPrefs((p) => {
      const current = { ...(p.categories[key] || {}) };
      if (patch.muted !== undefined) current.muted = patch.muted;
      if (patch.sound !== undefined) {
        if (patch.sound) current.sound = patch.sound;
        else delete current.sound;
      }
      return { ...p, categories: { ...p.categories, [key]: current } };
    });
  }
  async function savePrefs(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = cleanPreferences(prefs);
      const result = await savePreferences(next);
      if (!result.ok) throw Error(result.error || "Could not save preferences");
      onPreferencesSaved?.(next);
      setMessage("Sound preferences saved.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save preferences. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const categories: Record<string, string> = {};
      for (const [k, v] of Object.entries(company.categories))
        if (isValidSound(v)) categories[k] = v;
      const next: CompanySettings = {
        ...settings,
        sounds: {
          default: isValidSound(company.default)
            ? company.default
            : FALLBACK_SOUND,
          categories,
        },
      };
      const result = await saveSettings(next);
      if (!result.ok)
        throw Error(result.error || "Could not save company defaults");
      onCompanySaved?.(next);
      setMessage("Company-wide sound defaults saved.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save company defaults. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const snoozeActive =
    prefs.snoozed_until && new Date(prefs.snoozed_until) > new Date();
  const uploadInput = (key: string, apply: (path: string) => void) => (
    <label
      className={`mb-0 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted ${uploading === key ? "opacity-50" : ""}`}
      title="Upload an MP3 or WAV up to 5 MB"
    >
      {uploading === key ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Upload size={12} />
      )}
      Upload
      <input
        type="file"
        accept="audio/mpeg,audio/wav,.mp3,.wav"
        className="hidden"
        disabled={Boolean(uploading)}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          upload(f, apply, key);
        }}
      />
    </label>
  );
  const libraryOptions = (current: string | undefined, inherit: string) => (
    <>
      <option value="">{inherit}</option>
      {soundLibrary.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
      {isUploaded(current) && (
        <option value={current}>{customLabel(current)}</option>
      )}
    </>
  );
  return (
    <div className="space-y-6">
      {(message || error) && (
        <p role="status" className={error ? "error" : "notice"}>
          {error || message}
        </p>
      )}
      {blocked && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
        >
          <AlertTriangle size={15} className="shrink-0 text-warning" />
          <span className="flex-1">
            Your browser blocked sound playback. Click anywhere on the page,
            then try the preview again. Alerts still appear in your inbox.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => preview(userDefault.sound, "retry")}
          >
            Try again
          </Button>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => setBlocked(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      <form onSubmit={savePrefs} className="panel">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="section-title">Sound & notification settings</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose how Orbit sounds when reminders, reports and messages
              arrive. Changes apply after you save.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium">
            {prefs.muted ? (
              <VolumeX size={16} className="text-muted-foreground" />
            ) : (
              <Volume2 size={16} className="text-primary" />
            )}
            {prefs.muted ? "All sounds muted" : "Sounds on"}
            <Switch
              checked={!prefs.muted}
              onChange={(on) => setPrefs({ ...prefs, muted: !on })}
              label="Play alert sounds"
            />
          </div>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          <div>
            <label htmlFor="alert-volume">
              Alert volume · {Math.round(prefs.volume * 100)}%
            </label>
            <div className="flex items-center gap-3">
              <input
                id="alert-volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={prefs.volume}
                disabled={prefs.muted}
                onChange={(e) =>
                  setPrefs({ ...prefs, volume: Number(e.target.value) })
                }
                onPointerUp={schedulePreview}
                onKeyUp={schedulePreview}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={prefs.muted}
                onClick={() => preview(userDefault.sound, "volume")}
              >
                <Play size={12} />
                Test
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Release the slider to hear your default sound at the new level.
            </p>
          </div>
          <div>
            <label htmlFor="snooze-until">Snooze all alerts until</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="snooze-until"
                type="datetime-local"
                className="w-auto"
                value={toLocalInput(prefs.snoozed_until)}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    snoozed_until: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : undefined,
                  })
                }
              />
              {[
                ["1 hour", 60],
                ["4 hours", 240],
                ["Tomorrow 9:00", -1],
              ].map(([label, minutes]) => (
                <button
                  key={String(label)}
                  type="button"
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  onClick={() => {
                    const until = new Date();
                    if (minutes === -1) {
                      until.setDate(until.getDate() + 1);
                      until.setHours(9, 0, 0, 0);
                    } else
                      until.setMinutes(until.getMinutes() + Number(minutes));
                    setPrefs({ ...prefs, snoozed_until: until.toISOString() });
                  }}
                >
                  {label}
                </button>
              ))}
              {prefs.snoozed_until && (
                <button
                  type="button"
                  className="text-[11px] text-primary"
                  onClick={() =>
                    setPrefs({ ...prefs, snoozed_until: undefined })
                  }
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <BellOff size={12} />
              {snoozeActive
                ? `Silent until ${new Date(prefs.snoozed_until!).toLocaleString("en-IN")}. Alerts still arrive in your inbox.`
                : "Alerts stay silent until the chosen time, then resume automatically."}
            </p>
          </div>
        </div>
        <div className="border-t border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                Default sound for all reminders and notifications
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Used by every category without its own choice. Currently{" "}
                <span className="font-medium text-foreground">
                  {customLabel(userDefault.sound)}
                </span>{" "}
                · {describeSource(userDefault.source)}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {uploadInput("default", (path) =>
                setPrefs((p) => ({ ...p, default_sound: path })),
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!prefs.default_sound}
                onClick={() => setPrefs({ ...prefs, default_sound: undefined })}
              >
                <RotateCcw size={12} />
                Restore default
              </Button>
            </div>
          </div>
          <div
            role="radiogroup"
            aria-label="Default sound"
            className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
          >
            {[
              ...soundLibrary,
              ...(isUploaded(prefs.default_sound)
                ? [
                    {
                      value: prefs.default_sound,
                      label: customLabel(prefs.default_sound),
                      description: "Your uploaded sound.",
                    },
                  ]
                : []),
            ].map((s) => {
              const selected = (prefs.default_sound || "") === s.value;
              return (
                <div
                  key={s.value}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                >
                  <label className="mb-0 flex flex-1 cursor-pointer items-center gap-3 font-normal">
                    <input
                      type="radio"
                      name="default-sound"
                      value={s.value}
                      checked={selected}
                      onChange={() =>
                        setPrefs({ ...prefs, default_sound: s.value })
                      }
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">
                        {s.label}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {s.description}
                      </span>
                    </span>
                  </label>
                  {s.value !== SILENT_SOUND && (
                    <PreviewButton
                      label={"Preview " + s.label}
                      busy={playing === "lib:" + s.value}
                      onClick={() => preview(s.value, "lib:" + s.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="border-t border-border p-5">
          <h3 className="text-sm font-semibold">Sounds by category</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Give important categories their own sound, or mute the ones you
            prefer to read later.
          </p>
          <div className="mt-5 space-y-6">
            {groups.map((group) => (
              <div key={group}>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground/80">
                    {group}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {groupHints[group]}
                  </span>
                </div>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {notificationCategories
                    .filter((c) => c.group === group)
                    .map((c) => {
                      const entry = prefs.categories[c.key] || {};
                      const resolved = resolveSound(
                        c.key,
                        prefs,
                        effectiveCompany,
                      );
                      return (
                        <div
                          key={c.key}
                          className={`flex flex-wrap items-center gap-2 p-3 ${entry.muted ? "bg-muted/40" : ""}`}
                        >
                          <div className="min-w-[160px] flex-1">
                            <p className="text-xs font-medium">{c.label}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {entry.muted
                                ? "Muted"
                                : `${customLabel(resolved.sound)} · ${describeSource(resolved.source)}`}
                            </p>
                          </div>
                          <select
                            aria-label={`Sound for ${c.label}`}
                            className="h-8 w-auto max-w-[200px] py-0 text-xs"
                            value={entry.sound || ""}
                            disabled={entry.muted}
                            onChange={(e) =>
                              setCategory(c.key, {
                                sound: e.target.value || null,
                              })
                            }
                          >
                            {libraryOptions(
                              entry.sound,
                              `Use default (${labelSound(userDefault.sound)})`,
                            )}
                          </select>
                          {uploadInput(c.key, (path) =>
                            setCategory(c.key, { sound: path }),
                          )}
                          <PreviewButton
                            label={`Preview ${c.label} sound`}
                            busy={playing === "cat:" + c.key}
                            onClick={() =>
                              preview(resolved.sound, "cat:" + c.key)
                            }
                          />
                          <label className="mb-0 flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={Boolean(entry.muted)}
                              onChange={(e) =>
                                setCategory(c.key, { muted: e.target.checked })
                              }
                            />
                            Mute
                          </label>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
          <p className="text-[11px] text-muted-foreground">
            Sounds play while the workspace is open. Push notifications use your
            device’s own sound.
          </p>
          <Button type="submit" disabled={busy || Boolean(uploading)}>
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            Save preferences
          </Button>
        </div>
      </form>
      {admin && (
        <form onSubmit={saveCompany} className="panel">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
            <div className="flex items-start gap-3">
              <span className="icon-tile h-9 w-9">
                <Building2 size={17} />
              </span>
              <div>
                <h2 className="section-title">Company-wide defaults</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  The starting point for everyone. Individual preferences
                  override these company defaults.
                </p>
              </div>
            </div>
            {!settings && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/sounds">
                  Edit on the sound settings page
                  <ArrowUpRight size={13} />
                </Link>
              </Button>
            )}
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <label htmlFor="company-default">Company default sound</label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id="company-default"
                  className="h-9 w-auto max-w-[220px] py-0 text-xs"
                  value={company.default}
                  disabled={!settings}
                  onChange={(e) =>
                    setCompany({
                      ...company,
                      default: e.target.value || FALLBACK_SOUND,
                    })
                  }
                >
                  {soundLibrary.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                  {isUploaded(company.default) && (
                    <option value={company.default}>
                      {customLabel(company.default)}
                    </option>
                  )}
                </select>
                {settings &&
                  uploadInput("company-default", (path) =>
                    setCompany((c) => ({ ...c, default: path })),
                  )}
                <PreviewButton
                  label="Preview company default"
                  busy={playing === "company-default"}
                  onClick={() => preview(company.default, "company-default")}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Uploaded company sounds are served to every employee from your
                account’s sound library.
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold">Category defaults</p>
              <div className="divide-y divide-border rounded-lg border border-border">
                {notificationCategories.map((c) => (
                  <div
                    key={c.key}
                    className="flex flex-wrap items-center gap-2 p-2.5"
                  >
                    <span className="min-w-[150px] flex-1 text-xs">
                      {c.label}
                    </span>
                    <select
                      aria-label={`Company default for ${c.label}`}
                      className="h-8 w-auto max-w-[200px] py-0 text-xs"
                      value={company.categories[c.key] || ""}
                      disabled={!settings}
                      onChange={(e) =>
                        setCompany((cur) => {
                          const categories = { ...cur.categories };
                          if (e.target.value)
                            categories[c.key] = e.target.value;
                          else delete categories[c.key];
                          return { ...cur, categories };
                        })
                      }
                    >
                      {libraryOptions(
                        company.categories[c.key],
                        `Company default (${labelSound(company.default)})`,
                      )}
                    </select>
                    {settings &&
                      uploadInput("company:" + c.key, (path) =>
                        setCompany((cur) => ({
                          ...cur,
                          categories: { ...cur.categories, [c.key]: path },
                        })),
                      )}
                    <PreviewButton
                      label={`Preview company sound for ${c.label}`}
                      busy={playing === "company:" + c.key}
                      onClick={() =>
                        preview(
                          company.categories[c.key] || company.default,
                          "company:" + c.key,
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {settings && (
            <div className="flex justify-end border-t border-border p-5">
              <Button type="submit" disabled={busy || Boolean(uploading)}>
                {busy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Check size={14} />
                )}
                Save company defaults
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
