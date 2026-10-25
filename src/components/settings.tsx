"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Volume2,
  ShieldCheck,
  CalendarClock,
  Upload,
} from "lucide-react";
import { saveSettings, savePreferences, subscribePush } from "@/lib/actions";
import type { Profile } from "@/lib/modules";
import type { Preferences } from "./notifications";
import type { CompanySounds } from "@/lib/notification-types";
import type { EmailSettings } from "@/lib/email";
import { uploadFile } from "./attachments";
import { Button } from "./ui/button";
import { playAlertSound } from "@/lib/audio";
import { SoundSettings } from "./settings-panels/sounds";
import { ReminderPolicySettings } from "./settings-panels/reminders";
import { EmailSettingsPanel, type EmailLogRow } from "./settings-panels/email";
import {
  EmployeeIdSettingsPanel,
  type EmployeeIdSettings,
} from "./settings-panels/employee-ids";
import { ChatPolicySettings } from "./settings-panels/chat";
export type CompanySettings = {
  timezone: string;
  working_days: number[];
  office_start: string;
  office_end: string;
  grace_minutes: number;
  half_day_hours: number;
  attendance_reminder: string;
  eod_reminder: string;
  eod_deadline: string;
  office_lat: number | null;
  office_lng: number | null;
  geofence_radius: number;
  enforce_geofence: boolean;
  holidays: string[];
  special_days: {
    date: string;
    working: boolean;
    attendance_reminder?: string;
    eod_reminder?: string;
  }[];
  renewal_days: number;
  reminder_intervals: number[];
  reminder_yearly_advance_months: number;
  reminder_monthly_advance_days: number;
  reminder_repeat_daily: boolean;
  reminder_default_recurrence:
    | "none"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "custom";
  reminder_snooze_options: number[];
  reminder_escalate_days: number;
  notification_channels: {
    in_app: boolean;
    sound: boolean;
    push: boolean;
    email: boolean;
  };
  sounds: CompanySounds;
  chat: {
    group_creation: "admins" | "managers" | "everyone";
    direct_messages: "everyone" | "team";
    edit_minutes: number;
    admin_review: boolean;
  };
};
export type SettingsTab =
  | "notifications"
  | "sounds"
  | "reminders"
  | "company"
  | "chat"
  | "email"
  | "employee IDs"
  | "leave policy"
  | "scheduler";
const categories = [
  "renewals",
  "attendance",
  "eod",
  "approvals",
  "payments",
  "questions",
  "followups",
  "tasks",
  "maintenance",
  "stock",
];
export function Settings({
  profile,
  settings,
  preferences,
  runs,
  policies,
  emailSettings,
  emailLog,
  employeeIdSettings,
  employeeIdPreview,
  initialTab = "notifications",
  allowedTabs,
  canManageAccess = false,
}: {
  /** Tabs this person may open; each is enforced again when saving. */
  allowedTabs?: SettingsTab[];
  canManageAccess?: boolean;
  profile: Profile;
  settings: CompanySettings;
  preferences: Preferences;
  emailSettings: EmailSettings | null;
  emailLog: EmailLogRow[];
  employeeIdSettings: EmployeeIdSettings | null;
  employeeIdPreview: string;
  initialTab?: SettingsTab;
  runs: {
    id: number;
    started_at: string;
    finished_at: string;
    notification_count: number;
    error: string | null;
  }[];
  policies: {
    type: string;
    allocation: number;
    accrual: string;
    carry_forward: number;
    eligibility_days: number;
    paid: boolean;
  }[];
}) {
  const router = useRouter();
  const [s, setS] = useState(settings);
  const [p, setP] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  async function enablePush() {
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw Error(
          "Push is not supported on this browser. Use in-app notifications.",
        );
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw Error("Your Admin needs to configure push keys first.");
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Notification permission was not granted.");
      const registration = await navigator.serviceWorker.ready;
      const normalized = key.replaceAll("-", "+").replaceAll("_", "/");
      const bytes = Uint8Array.from(
        atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
        (c) => c.charCodeAt(0),
      );
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      const result = await subscribePush(subscription.toJSON());
      if (!result.ok) throw Error(result.error);
      setMessage("Push notifications enabled on this device.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Push setup failed");
    }
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Make your workspace work for you.
      </p>
      <div className="my-6 flex flex-wrap gap-3 border-b">
        {(
          allowedTabs ||
          ([
            "notifications",
            "sounds",
            ...(profile.role === "super_admin"
              ? [
                  "reminders",
                  "company",
                  "chat",
                  "email",
                  "employee IDs",
                  "leave policy",
                  "scheduler",
                ]
              : []),
          ] as SettingsTab[])
        ).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setMessage("");
              router.replace(
                "/settings?tab=" + encodeURIComponent(t.replaceAll(" ", "-")),
                { scroll: false },
              );
            }}
            aria-current={tab === t ? "page" : undefined}
            className={`border-b-2 px-3 pb-3 text-xs capitalize ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
        {canManageAccess && (
          <Link
            href="/settings/roles"
            className="border-b-2 border-transparent px-3 pb-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Roles & permissions
          </Link>
        )}
      </div>
      {message && (
        <p
          role="status"
          className="mb-5 rounded-lg border bg-primary/5 p-3 text-sm"
        >
          {message}
        </p>
      )}
      {tab === "notifications" && (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <form
            className="panel p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setMessage("");
              try {
                const r = await savePreferences(p);
                setMessage(
                  r.ok
                    ? "Notification preferences saved."
                    : r.error || "Unable to save preferences.",
                );
                if (r.ok) router.refresh();
              } catch {
                setMessage(
                  "Could not save preferences. Check your connection and try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="section-title">
                Sounds & notification preferences
              </h2>
              <label className="mb-0 flex items-center gap-2 font-normal">
                <input
                  type="checkbox"
                  checked={p.muted}
                  onChange={(e) => setP({ ...p, muted: e.target.checked })}
                />
                Mute all
              </label>
            </div>
            <label className="mt-6">
              Alert volume · {Math.round(p.volume * 100)}%
            </label>
            <input
              aria-label="Alert volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={p.volume}
              onChange={(e) => setP({ ...p, volume: Number(e.target.value) })}
            />
            <div className="mt-5 space-y-4">
              {categories.map((c) => (
                <div
                  key={c}
                  className="flex flex-wrap items-center gap-3 border-t pt-4"
                >
                  <span className="flex-1 text-xs font-medium capitalize">
                    {c}
                  </span>
                  <label className="mb-0 flex items-center gap-2 text-[10px] font-normal">
                    <input
                      type="checkbox"
                      checked={p.categories[c]?.muted || false}
                      onChange={(e) =>
                        setP({
                          ...p,
                          categories: {
                            ...p.categories,
                            [c]: {
                              ...p.categories[c],
                              muted: e.target.checked,
                            },
                          },
                        })
                      }
                    />
                    Mute
                  </label>
                  <label className="mb-0 cursor-pointer text-[10px] text-primary">
                    <Upload size={12} className="mr-1 inline" />
                    {p.categories[c]?.sound ? "Change sound" : "Upload sound"}
                    <input
                      type="file"
                      accept="audio/mpeg,audio/wav,.mp3,.wav"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setBusy(true);
                        try {
                          const path = await uploadFile(undefined, f, true);
                          setP({
                            ...p,
                            categories: {
                              ...p.categories,
                              [c]: { ...p.categories[c], sound: path },
                            },
                          });
                          setMessage(
                            "Sound uploaded. Save preferences to apply it.",
                          );
                        } catch (e) {
                          setMessage(
                            e instanceof Error ? e.message : "Upload failed",
                          );
                        }
                        setBusy(false);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={"Preview " + c + " sound"}
                    className="rounded-md p-1.5 hover:bg-muted disabled:opacity-30"
                    onClick={() => {
                      playAlertSound(p.categories[c]?.sound, p.volume).catch(
                        () =>
                          setMessage(
                            "Browser blocked audio. Check device settings and try again.",
                          ),
                      );
                    }}
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <label>Snooze all alerts until (optional)</label>
              <input
                type="datetime-local"
                value={
                  p.snoozed_until
                    ? new Date(
                        new Date(p.snoozed_until).getTime() -
                          new Date().getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  setP({
                    ...p,
                    snoozed_until: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : undefined,
                  })
                }
              />
            </div>
            <Button className="mt-6" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save preferences"}
            </Button>
          </form>
          <div className="space-y-5">
            <section className="panel p-5">
              <Bell size={24} className="mb-4 text-primary" />
              <h2 className="section-title">Updates that come to you</h2>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                Enable browser push notifications to receive updates when your
                workspace is closed. Permission is specific to this device.
              </p>
              <Button className="mt-5" onClick={enablePush}>
                Enable push notifications
              </Button>
            </section>
            <section className="panel p-5">
              <h2 className="section-title">How alerts work</h2>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                Custom sounds play while you have the workspace open. Your
                browser may require a click before it allows sound. Push
                notification sounds are controlled by your device, so uploaded
                sounds cannot be guaranteed for closed-browser alerts.
              </p>
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                On iPhone and iPad, compatible web push generally requires
                installing this workspace to your Home Screen. In-app
                notifications remain available if push or sound is blocked.
              </p>
            </section>
          </div>
        </div>
      )}
      {tab === "sounds" && (
        <SoundSettings
          profile={profile}
          preferences={p}
          companySounds={s.sounds}
          settings={s}
          onPreferencesSaved={setP}
          onCompanySaved={setS}
        />
      )}
      {tab === "reminders" && (
        <ReminderPolicySettings settings={s} onSaved={setS} />
      )}
      {tab === "chat" && <ChatPolicySettings settings={s} onSaved={setS} />}
      {tab === "email" && emailSettings && (
        <EmailSettingsPanel settings={emailSettings} log={emailLog} />
      )}
      {tab === "employee IDs" && employeeIdSettings && (
        <EmployeeIdSettingsPanel
          settings={employeeIdSettings}
          preview={employeeIdPreview}
        />
      )}
      {tab === "company" && (
        <form
          className="panel max-w-4xl p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setMessage("");
            try {
              const r = await saveSettings(s);
              setMessage(
                r.ok
                  ? "Company settings saved."
                  : r.error || "Unable to save settings.",
              );
              if (r.ok) router.refresh();
            } catch {
              setMessage(
                "Could not save settings. Check your connection and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="section-title mb-6">
            Company, attendance & reminder policy
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            {[
              ["timezone", "Company timezone"],
              ["office_start", "Office start time"],
              ["office_end", "Office end time"],
              ["attendance_reminder", "Attendance reminder"],
              ["eod_reminder", "Daily report reminder"],
              ["eod_deadline", "Final daily report deadline"],
              ["grace_minutes", "Attendance grace minutes"],
              ["half_day_hours", "Minimum hours for a full day"],
              ["office_lat", "Office latitude"],
              ["office_lng", "Office longitude"],
              ["geofence_radius", "Geofence radius (metres)"],
              [
                "renewal_days",
                "Daily renewal alerts start (days before expiry)",
              ],
            ].map(([key, label]) => {
              const time = [
                "office_start",
                "office_end",
                "attendance_reminder",
                "eod_reminder",
                "eod_deadline",
              ].includes(key);
              const numeric = [
                "grace_minutes",
                "half_day_hours",
                "office_lat",
                "office_lng",
                "geofence_radius",
                "renewal_days",
              ].includes(key);
              return (
                <div key={key}>
                  <label>{label}</label>
                  <input
                    type={time ? "time" : numeric ? "number" : "text"}
                    step={
                      key.includes("lat") || key.includes("lng") ? "any" : "1"
                    }
                    value={String(s[key as keyof CompanySettings] ?? "")}
                    onChange={(e) =>
                      setS({
                        ...s,
                        [key]: numeric
                          ? e.target.value === ""
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      })
                    }
                  />
                </div>
              );
            })}
            <div className="md:col-span-2">
              <label>Working days</label>
              <div className="flex flex-wrap gap-4">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (label, day) => (
                    <label
                      key={day}
                      className="flex items-center gap-2 font-normal"
                    >
                      <input
                        type="checkbox"
                        checked={s.working_days.includes(day)}
                        onChange={(e) =>
                          setS({
                            ...s,
                            working_days: e.target.checked
                              ? [...s.working_days, day]
                              : s.working_days.filter((d) => d !== day),
                          })
                        }
                      />
                      {label}
                    </label>
                  ),
                )}
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.enforce_geofence}
                  onChange={(e) =>
                    setS({ ...s, enforce_geofence: e.target.checked })
                  }
                />
                Require office geofence for office clock-ins
              </label>
            </div>
            <div>
              <label>Holidays (one date per line)</label>
              <textarea
                value={s.holidays.join("\n")}
                placeholder="2026-10-20"
                onChange={(e) =>
                  setS({
                    ...s,
                    holidays: e.target.value.split("\n").filter(Boolean),
                  })
                }
              />
            </div>
            <div>
              <label>Priority renewal alerts (days, comma separated)</label>
              <input
                value={s.reminder_intervals.join(",")}
                onChange={(e) =>
                  setS({
                    ...s,
                    reminder_intervals: e.target.value
                      .split(",")
                      .filter(Boolean)
                      .map(Number),
                  })
                }
              />
            </div>
            <div className="md:col-span-2">
              <label>Special working day</label>
              <div className="flex flex-wrap gap-3">
                <input type="date" id="special-date" className="w-44" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const date = (
                      document.getElementById(
                        "special-date",
                      ) as HTMLInputElement
                    ).value;
                    if (date)
                      setS({
                        ...s,
                        special_days: [
                          ...s.special_days.filter((d) => d.date !== date),
                          { date, working: true },
                        ],
                      });
                  }}
                >
                  Add working day
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const date = (
                      document.getElementById(
                        "special-date",
                      ) as HTMLInputElement
                    ).value;
                    if (date)
                      setS({
                        ...s,
                        special_days: [
                          ...s.special_days.filter((d) => d.date !== date),
                          { date, working: false },
                        ],
                      });
                  }}
                >
                  Add day off
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {s.special_days.map((day) => (
                  <div
                    key={day.date}
                    className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-xs"
                  >
                    <span>
                      {day.date} · {day.working ? "Working" : "Day off"}
                    </span>
                    {day.working && (
                      <>
                        <input
                          aria-label="Special attendance reminder"
                          type="time"
                          className="w-28"
                          value={
                            day.attendance_reminder || s.attendance_reminder
                          }
                          onChange={(e) =>
                            setS({
                              ...s,
                              special_days: s.special_days.map((d) =>
                                d.date === day.date
                                  ? {
                                      ...d,
                                      attendance_reminder: e.target.value,
                                    }
                                  : d,
                              ),
                            })
                          }
                        />
                        <input
                          aria-label="Special EOD reminder"
                          type="time"
                          className="w-28"
                          value={day.eod_reminder || s.eod_reminder}
                          onChange={(e) =>
                            setS({
                              ...s,
                              special_days: s.special_days.map((d) =>
                                d.date === day.date
                                  ? { ...d, eod_reminder: e.target.value }
                                  : d,
                              ),
                            })
                          }
                        />
                      </>
                    )}
                    <button
                      type="button"
                      className="text-danger"
                      onClick={() =>
                        setS({
                          ...s,
                          special_days: s.special_days.filter(
                            (d) => d.date !== day.date,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <Button className="mt-6" disabled={busy}>
            Save company policy
          </Button>
        </form>
      )}
      {tab === "scheduler" && (
        <section className="panel p-6">
          <h2 className="section-title">Scheduler health</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your external scheduler must call the secured tick endpoint every
            five minutes.
          </p>
          <div className="my-4 rounded-lg border p-4 text-xs">
            {runs[0]
              ? `Last run: ${new Date(runs[0].started_at).toLocaleString("en-IN")} · ${runs[0].finished_at ? "Completed" : "Incomplete"}`
              : "No scheduler runs yet. Complete the scheduler setup in docs/SETUP.md."}
          </div>
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="p-3">Started</th>
                <th className="p-3">Notifications</th>
                <th className="p-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    {new Date(r.started_at).toLocaleString("en-IN")}
                  </td>
                  <td className="p-3">{r.notification_count}</td>
                  <td className="p-3">
                    {r.error || (r.finished_at ? "Completed" : "Running")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === "leave policy" && (
        <section className="panel p-6">
          <h2 className="section-title">Leave policies</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Allocations accrue when the scheduler runs. Annual balances reset
            with configured carry-forward; monthly balances accrue once per
            month.
          </p>
          <div className="mt-6 space-y-5">
            {policies.map((policy) => (
              <form
                key={policy.type}
                className="grid items-end gap-3 rounded-lg border p-4 md:grid-cols-6"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const res = await fetch("/api/admin/leave-policy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      type: policy.type,
                      allocation: Number(f.get("allocation")),
                      accrual: f.get("accrual"),
                      carry_forward: Number(f.get("carry")),
                      eligibility_days: Number(f.get("eligibility")),
                      paid: f.get("paid") === "on",
                    }),
                  });
                  const result = await res.json();
                  setMessage(res.ok ? "Leave policy updated." : result.error);
                  router.refresh();
                }}
              >
                <div className="md:col-span-6 text-sm font-semibold">
                  {policy.type}
                </div>
                <div>
                  <label>Allocation</label>
                  <input
                    name="allocation"
                    type="number"
                    min="0"
                    step="0.5"
                    defaultValue={policy.allocation}
                  />
                </div>
                <div>
                  <label>Accrual</label>
                  <select name="accrual" defaultValue={policy.accrual}>
                    {["annual", "monthly", "none"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Carry-forward cap</label>
                  <input
                    name="carry"
                    type="number"
                    min="0"
                    defaultValue={policy.carry_forward}
                  />
                </div>
                <div>
                  <label>Eligibility days</label>
                  <input
                    name="eligibility"
                    type="number"
                    min="0"
                    defaultValue={policy.eligibility_days}
                  />
                </div>
                <label className="flex items-center gap-2">
                  <input
                    name="paid"
                    type="checkbox"
                    defaultChecked={policy.paid}
                  />
                  Paid leave
                </label>
                <Button type="submit" size="sm">
                  Save policy
                </Button>
              </form>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
