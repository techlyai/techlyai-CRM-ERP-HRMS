"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, Save } from "lucide-react";
import type { CompanySettings } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/lib/actions";
import {
  defaultPolicy,
  recurrenceOptions,
  snoozeLabel,
  snoozeOptions,
  type Recurrence,
} from "@/lib/reminders";

export function ReminderPolicySettings({
  settings,
  onSaved,
}: {
  settings: CompanySettings;
  onSaved?: (settings: CompanySettings) => void;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [yearly, setYearly] = useState(
    String(
      settings.reminder_yearly_advance_months ??
        defaultPolicy.reminder_yearly_advance_months,
    ),
  );
  const [monthly, setMonthly] = useState(
    String(
      settings.reminder_monthly_advance_days ??
        defaultPolicy.reminder_monthly_advance_days,
    ),
  );
  const [escalate, setEscalate] = useState(
    String(
      settings.reminder_escalate_days ?? defaultPolicy.reminder_escalate_days,
    ),
  );
  const [repeat, setRepeat] = useState(
    settings.reminder_repeat_daily ?? defaultPolicy.reminder_repeat_daily,
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(
    settings.reminder_default_recurrence || "none",
  );
  const [snooze, setSnooze] = useState(snoozeOptions(settings).join(", "));
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const durations = snooze
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  const validSnooze =
    durations.length > 0 &&
    durations.length <= 10 &&
    durations.every(
      (duration) =>
        Number.isInteger(duration) && duration > 0 && duration <= 525600,
    );
  const disabled = saving || refreshing;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || refreshing) return;
    if (!validSnooze) {
      setMessage({
        error: true,
        text: "Enter 1 to 10 snooze durations in minutes, each a whole number between 1 and 525600.",
      });
      return;
    }
    lock.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const nextSettings: CompanySettings = {
        ...settings,
        reminder_yearly_advance_months: Number(yearly),
        reminder_monthly_advance_days: Number(monthly),
        reminder_escalate_days: Number(escalate),
        reminder_repeat_daily: repeat,
        reminder_default_recurrence: recurrence,
        reminder_snooze_options: Array.from(new Set(durations)),
      };
      const result = await saveSettings(nextSettings);
      if (!result.ok)
        throw Error(
          result.error || "Could not save reminder settings. Please try again.",
        );
      setMessage({ error: false, text: "Reminder settings saved." });
      onSaved?.(nextSettings);
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "Could not save reminder settings. Please try again.",
      });
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      className="panel mt-6 max-w-4xl p-5 sm:p-6"
      onSubmit={submit}
      aria-busy={disabled}
    >
      <div className="flex items-center gap-3">
        <span className="icon-tile h-10 w-10">
          <BellRing size={19} />
        </span>
        <div>
          <h2 className="section-title">Reminder defaults</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the default timing and follow-up options for your team.
          </p>
        </div>
      </div>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "error mt-5" : "notice mt-5"}
        >
          {message.text}
        </p>
      )}
      <fieldset disabled={disabled} className="mt-6 min-w-0 space-y-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="policy-yearly">
              Yearly reminders: months before due
            </label>
            <input
              id="policy-yearly"
              type="number"
              min={0}
              max={12}
              step={1}
              required
              value={yearly}
              onChange={(event) => setYearly(event.target.value)}
              aria-describedby="policy-yearly-hint"
            />
            <p
              id="policy-yearly-hint"
              className="mt-2 text-xs leading-5 text-muted-foreground"
            >
              Choose 0 to alert at the due time. A reminder’s custom advance
              takes priority.
            </p>
          </div>
          <div>
            <label htmlFor="policy-monthly">
              Monthly reminders: days before due
            </label>
            <input
              id="policy-monthly"
              type="number"
              min={0}
              max={90}
              step={1}
              required
              value={monthly}
              onChange={(event) => setMonthly(event.target.value)}
              aria-describedby="policy-monthly-hint"
            />
            <p
              id="policy-monthly-hint"
              className="mt-2 text-xs leading-5 text-muted-foreground"
            >
              Choose 0 to alert at the due time. Applies to monthly reminders
              using the default.
            </p>
          </div>
          <div>
            <label htmlFor="policy-recurrence">
              Repeat option for new reminders
            </label>
            <select
              id="policy-recurrence"
              value={recurrence}
              onChange={(event) =>
                setRecurrence(event.target.value as Recurrence)
              }
            >
              {recurrenceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === "none" ? "Does not repeat" : option.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              People can choose a different schedule when creating a reminder.
            </p>
          </div>
          <div>
            <label htmlFor="policy-escalate">
              Notify managers after days overdue
            </label>
            <input
              id="policy-escalate"
              type="number"
              min={0}
              max={90}
              step={1}
              required
              value={escalate}
              onChange={(event) => setEscalate(event.target.value)}
              aria-describedby="policy-escalate-hint"
            />
            <p
              id="policy-escalate-hint"
              className="mt-2 text-xs leading-5 text-muted-foreground"
            >
              Choose 0 to turn off manager escalation. High and urgent overdue
              reminders also notify administrators.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border p-4">
          <label
            className="mb-0 flex items-start gap-3"
            htmlFor="policy-repeat"
          >
            <input
              id="policy-repeat"
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={repeat}
              onChange={(event) => setRepeat(event.target.checked)}
            />
            <span>
              Repeat alerts daily until completed
              <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                When off, each occurrence sends one scheduled alert. Snoozing
                pauses alerts for the selected duration.
              </span>
            </span>
          </label>
        </div>
        <div>
          <label htmlFor="policy-snooze">Snooze choices, in minutes</label>
          <input
            id="policy-snooze"
            value={snooze}
            maxLength={150}
            required
            placeholder="10, 30, 60, 1440, 10080"
            onChange={(event) => setSnooze(event.target.value)}
            aria-describedby="policy-snooze-hint"
          />
          <p
            id="policy-snooze-hint"
            className="mt-2 text-xs leading-5 text-muted-foreground"
          >
            Separate up to 10 durations with commas. 60 = 1 hour; 1440 = 1 day;
            10080 = 1 week.
          </p>
          {validSnooze && (
            <p className="mt-2 text-xs text-primary">
              Choices:{" "}
              {Array.from(new Set(durations)).map(snoozeLabel).join(" · ")}
            </p>
          )}
        </div>
      </fieldset>
      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Changes to alert timing apply when a reminder is saved or its next
        occurrence is scheduled. Recurring dates use the company timezone:{" "}
        {settings.timezone || defaultPolicy.timezone}.
      </p>
      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={disabled}>
          {disabled ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {saving ? "Saving…" : "Save reminder defaults"}
        </Button>
      </div>
    </form>
  );
}
