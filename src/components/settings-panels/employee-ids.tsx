"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Eye, Loader2, Save } from "lucide-react";
import { saveEmployeeIdSettings } from "@/lib/admin-actions";
import { Button } from "@/components/ui/button";

export type EmployeeIdSettings = {
  prefix: string;
  include_department: boolean;
  branch_code: string;
  include_year: boolean;
  separator: string;
  digits: number;
  start: number;
  scope: "global" | "department";
  reset: "never" | "yearly";
  allow_manual: boolean;
  welcome_email: boolean;
};
type Draft = Omit<EmployeeIdSettings, "digits" | "start"> & {
  digits: string;
  start: string;
};
const toDraft = (settings: EmployeeIdSettings): Draft => ({
  ...settings,
  digits: String(settings.digits),
  start: String(settings.start),
});

export function EmployeeIdSettingsPanel({
  settings,
  preview,
}: {
  settings: EmployeeIdSettings;
  preview: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [saved, setSaved] = useState(settings);
  const [draft, setDraft] = useState(() => toDraft(settings));
  const [department, setDepartment] = useState("");
  const [shownDepartment, setShownDepartment] = useState("");
  const [nextId, setNextId] = useState(preview);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const lock = useRef(false);
  const disabled = Boolean(busy) || refreshing;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(saved));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function readPreview() {
    setPreviewError("");
    try {
      const response = await fetch(
        "/api/employee-id/preview?" +
          new URLSearchParams({ department: department.trim() }),
        { cache: "no-store" },
      );
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw Error(
          detail?.error || "Could not preview the next ID. Please try again.",
        );
      }
      const result = (await response.json()) as { id?: string };
      if (!result.id || typeof result.id !== "string")
        throw Error(
          "Could not preview the next ID. Refresh the page and try again.",
        );
      setNextId(result.id);
      setShownDepartment(department.trim());
    } catch (error) {
      setNextId("");
      setPreviewError(
        error instanceof Error
          ? error.message
          : "Could not preview the next ID. Please try again.",
      );
    }
  }

  async function previewNext() {
    if (lock.current || refreshing) return;
    lock.current = true;
    setBusy("preview");
    try {
      await readPreview();
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || refreshing) return;
    const digits = Number(draft.digits);
    const start = Number(draft.start);
    if (
      !Number.isInteger(digits) ||
      digits < 1 ||
      digits > 8 ||
      !Number.isInteger(start) ||
      start < 1 ||
      String(start).length > digits
    ) {
      setMessage({
        error: true,
        text: "Choose 1 to 8 sequence digits and a positive starting number that fits within that width.",
      });
      return;
    }
    if (
      !/^[A-Za-z0-9/_-]*$/.test(draft.prefix.trim()) ||
      !/^[A-Za-z0-9/_-]*$/.test(draft.branch_code.trim())
    ) {
      setMessage({
        error: true,
        text: "Use letters, numbers, /, _ or - in the prefix and branch code.",
      });
      return;
    }
    lock.current = true;
    setBusy("save");
    setMessage(null);
    try {
      const next: EmployeeIdSettings = {
        ...draft,
        prefix: draft.prefix.trim(),
        branch_code: draft.branch_code.trim(),
        digits,
        start,
      };
      const result = await saveEmployeeIdSettings(next);
      if (!result.ok)
        throw Error(
          result.error || "Could not save the ID format. Please try again.",
        );
      setSaved(next);
      setDraft(toDraft(next));
      setMessage({
        error: false,
        text: "Employee ID settings saved. The format will be used for new employee records.",
      });
      await readPreview();
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "Could not save the ID format. Please try again.",
      });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="panel mt-6 max-w-4xl p-5 sm:p-6" aria-busy={disabled}>
      <div className="flex items-center gap-3">
        <span className="icon-tile h-10 w-10">
          <BadgeCheck size={19} />
        </span>
        <div>
          <h2 className="section-title">Employee ID format</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Choose how IDs are assigned when a new employee record is created.
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
      <form onSubmit={save} className="mt-6 space-y-5">
        <fieldset disabled={disabled} className="min-w-0 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="employee-id-prefix">Prefix</label>
              <input
                id="employee-id-prefix"
                value={draft.prefix}
                maxLength={20}
                placeholder="TECH-EMP"
                onChange={(event) => set("prefix", event.target.value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Optional. Letters, numbers, /, _ and - are supported.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-branch">Branch code</label>
              <input
                id="employee-id-branch"
                value={draft.branch_code}
                maxLength={10}
                placeholder="For example, BLR"
                onChange={(event) => set("branch_code", event.target.value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Optional. Appears after the department code.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-separator">
                Separator between parts
              </label>
              <input
                id="employee-id-separator"
                value={draft.separator}
                maxLength={3}
                placeholder="-"
                onChange={(event) => set("separator", event.target.value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Up to 3 characters. Leave empty to join the parts together.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-digits">Sequence digits</label>
              <input
                id="employee-id-digits"
                type="number"
                min={1}
                max={8}
                step={1}
                required
                value={draft.digits}
                onChange={(event) => set("digits", event.target.value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                For example, 4 digits displays sequence 1 as 0001.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-start">
                Starting number for new sequences
              </label>
              <input
                id="employee-id-start"
                type="number"
                min={1}
                max={99999999}
                step={1}
                required
                value={draft.start}
                onChange={(event) => set("start", event.target.value)}
              />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Must fit the sequence width. Existing sequences continue from
                their current number.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-scope">Numbering scope</label>
              <select
                id="employee-id-scope"
                value={draft.scope}
                onChange={(event) =>
                  set(
                    "scope",
                    event.target.value as EmployeeIdSettings["scope"],
                  )
                }
              >
                <option value="global">One sequence for the company</option>
                <option value="department">
                  Separate sequence per department
                </option>
              </select>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                For separate sequences, include the department code in the
                format.
              </p>
            </div>
            <div>
              <label htmlFor="employee-id-reset">Start a new sequence</label>
              <select
                id="employee-id-reset"
                value={draft.reset}
                onChange={(event) =>
                  set(
                    "reset",
                    event.target.value as EmployeeIdSettings["reset"],
                  )
                }
              >
                <option value="never">Never — continue numbering</option>
                <option value="yearly">Every calendar year</option>
              </select>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Include the year to distinguish IDs when numbering restarts
                annually.
              </p>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border p-4">
            <label
              htmlFor="employee-id-department"
              className="mb-0 flex items-start gap-3"
            >
              <input
                id="employee-id-department"
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={draft.include_department}
                onChange={(event) =>
                  set("include_department", event.target.checked)
                }
              />
              <span>
                Include department code
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Uses the first three letters, in uppercase; Sales becomes SAL.
                </span>
              </span>
            </label>
            <label
              htmlFor="employee-id-year"
              className="mb-0 flex items-center gap-3"
            >
              <input
                id="employee-id-year"
                type="checkbox"
                checked={draft.include_year}
                onChange={(event) => set("include_year", event.target.checked)}
              />
              Include the calendar year
            </label>
            <label
              htmlFor="employee-id-manual"
              className="mb-0 flex items-start gap-3"
            >
              <input
                id="employee-id-manual"
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={draft.allow_manual}
                onChange={(event) => set("allow_manual", event.target.checked)}
              />
              <span>
                Allow administrators to enter IDs manually
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Applies when creating employee records. Leaving the ID blank
                  generates one automatically.
                </span>
              </span>
            </label>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "You have unsaved changes."
              : "The saved format is shown above."}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !dirty}
              onClick={() => {
                setDraft(toDraft(saved));
                setMessage(null);
              }}
            >
              Discard changes
            </Button>
            <Button type="submit" disabled={disabled || !dirty}>
              {busy === "save" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              {busy === "save" ? "Saving…" : "Save ID format"}
            </Button>
          </div>
        </div>
      </form>
      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <h3 className="text-sm font-semibold">Preview the next ID</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Uses your saved settings. Previewing does not reserve an ID or advance
          the sequence.
          {dirty && " Save your changes to preview the updated format."}
        </p>
        <div className="mt-4">
          <label htmlFor="employee-preview-department">
            Department for preview{" "}
            <span className="font-normal">(optional)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="employee-preview-department"
              className="min-w-0 flex-1"
              placeholder="For example, Sales"
              value={department}
              maxLength={100}
              disabled={disabled}
              onChange={(event) => setDepartment(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={previewNext}
            >
              {busy === "preview" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Eye size={14} />
              )}
              Preview saved format
            </Button>
          </div>
        </div>
        {previewError && (
          <p role="alert" className="error mt-3">
            {previewError}
          </p>
        )}
        {nextId && (
          <div role="status" className="mt-4">
            <p className="text-xs text-muted-foreground">
              Next candidate
              {shownDepartment
                ? ` for ${shownDepartment}`
                : " without a department"}
            </p>
            <p className="mt-1 break-all font-mono text-lg font-semibold text-primary">
              {nextId}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The final ID is assigned when the employee record is saved.
            </p>
          </div>
        )}
      </div>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Employee ID email notices are controlled in{" "}
        <Link
          href="/settings?tab=email"
          className="font-medium text-primary hover:underline"
        >
          Email settings
        </Link>
        .
      </p>
    </section>
  );
}
