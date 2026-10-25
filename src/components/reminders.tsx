"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  BellRing,
  BellOff,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Undo2,
} from "lucide-react";
import { reminderAction, saveReminder } from "@/lib/reminder-actions";
import {
  advanceLabel,
  advanceUnitOptions,
  alertAt,
  categorySuggestions,
  defaultPolicy,
  formatDateTime,
  fromDateTimeLocal,
  isOverdue,
  isSnoozed,
  priorities,
  recurrenceLabel,
  recurrenceOptions,
  snoozeLabel,
  snoozeOptions,
  snoozeUntil,
  toDateTimeLocal,
  type AdvanceUnit,
  type Priority,
  type Recurrence,
  type Reminder,
  type ReminderPolicy,
} from "@/lib/reminders";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Status } from "./ui/status";

export type ReminderView = "active" | "overdue" | "completed" | "all";
type Viewer = { id: string; role: string };
type Notice = { kind: "success" | "error"; message: string } | null;

function canEdit(reminder: Reminder, viewer: Viewer) {
  return (
    viewer.role === "super_admin" ||
    reminder.owner_id === viewer.id ||
    reminder.created_by === viewer.id
  );
}

function listUrl(view: ReminderView, query: string, page = 1) {
  const params = new URLSearchParams({ view });
  if (query.trim()) params.set("q", query.trim());
  if (page > 1) params.set("page", String(page));
  return "/reminders?" + params.toString();
}

export function Reminders({
  initial,
  policy,
  viewer,
  names,
  view,
  query,
  page,
  hasMore,
  selected,
  missingSelection,
  initiallyCreate,
  now: initialNow,
}: {
  initial: Reminder[];
  policy: ReminderPolicy;
  viewer: Viewer;
  names: Record<string, string>;
  view: ReminderView;
  query: string;
  page: number;
  hasMore: boolean;
  selected: Reminder | null;
  missingSelection: boolean;
  initiallyCreate: boolean;
  now: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [search, setSearch] = useState(query);
  const [now, setNow] = useState(initialNow);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [editor, setEditor] = useState<Reminder | "new" | null>(null);
  const [snoozing, setSnoozing] = useState<Reminder | null>(null);
  const [cancelling, setCancelling] = useState<Reminder | null>(null);
  const [detailId, setDetailId] = useState(selected?.id || "");
  const timezone = policy.timezone || defaultPolicy.timezone;
  const disabled = Boolean(busy) || refreshing;
  const detail =
    initial.find((item) => item.id === detailId) ||
    (selected?.id === detailId ? selected : null);

  useEffect(() => setSearch(query), [query]);
  useEffect(() => {
    if (initiallyCreate) setEditor("new");
  }, [initiallyCreate]);
  useEffect(() => {
    setDetailId(selected?.id || "");
  }, [selected?.id]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(timer);
  }, []);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function act(
    item: Reminder,
    action: "complete" | "reopen" | "snooze" | "cancel",
    until?: string,
  ) {
    if (lock.current || refreshing) return;
    lock.current = true;
    setBusy(item.id);
    setNotice(null);
    try {
      const result = await reminderAction({
        id: item.id,
        version: item.version,
        action,
        until,
      });
      if (!result.ok)
        throw Error(
          result.error || "Could not update this reminder. Please try again.",
        );
      setSnoozing(null);
      setCancelling(null);
      setNotice({
        kind: "success",
        message:
          action === "complete"
            ? item.recurrence === "none"
              ? "Reminder completed."
              : "Occurrence completed. The next due date is ready."
            : action === "reopen"
              ? "Reminder reopened."
              : action === "cancel"
                ? "Reminder cancelled. Find it in All reminders to reopen it."
                : "Reminder snoozed. Its due date stays the same.",
      });
      refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update this reminder. Please try again.",
      });
      // A fresh version lets a user retry after another person updates the reminder.
      refresh();
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  function card(item: Reminder, inDialog = false) {
    const editable = canEdit(item, viewer);
    const overdue = isOverdue(item, now);
    const snoozed = item.status === "Pending" && isSnoozed(item, now);
    return (
      <article key={item.id} className={inDialog ? "mt-5" : "p-4 sm:p-5"}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${overdue ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"}`}
          >
            <BellRing size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Status value={overdue ? "Overdue" : item.status} />
              <span
                className={`text-xs font-medium ${item.priority === "Urgent" ? "text-danger" : item.priority === "High" ? "text-warning" : "text-muted-foreground"}`}
              >
                {item.priority} priority
              </span>
              <span className="text-xs text-muted-foreground">
                {item.category}
              </span>
            </div>
            {inDialog ? null : (
              <button
                type="button"
                onClick={() => setDetailId(item.id)}
                className="mt-2 max-w-full break-words text-left text-sm font-semibold hover:text-primary"
              >
                {item.title}
              </button>
            )}
            <p
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${inDialog ? "mt-3" : "mt-2"} ${overdue ? "text-danger" : "text-muted-foreground"}`}
            >
              <CalendarClock size={14} aria-hidden="true" />
              <span>
                Due{" "}
                <time dateTime={item.due_at}>
                  {formatDateTime(item.due_at, timezone)}
                </time>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {recurrenceLabel(item.recurrence, item.custom_interval_days)}
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {item.owner_id === viewer.id
                ? "Assigned to you"
                : "Assigned to " + (names[item.owner_id] || "a team member")}
            </p>
            {item.description && (
              <p
                className={`mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground ${inDialog ? "" : "line-clamp-2"}`}
              >
                {item.description}
              </p>
            )}
            {item.status === "Pending" && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {snoozed
                  ? "Alerts snoozed until " +
                    formatDateTime(item.snoozed_until!, timezone)
                  : "Alert: " +
                    advanceLabel(
                      item.recurrence,
                      item.advance_amount,
                      item.advance_unit,
                      policy,
                    )}
              </p>
            )}
            {item.completed_count > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {item.completed_count}{" "}
                {item.completed_count === 1 ? "occurrence" : "occurrences"}{" "}
                completed
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {editable && item.status === "Pending" && (
                <>
                  <Button
                    size="sm"
                    disabled={disabled}
                    onClick={() => act(item, "complete")}
                  >
                    {busy === item.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    {item.recurrence === "none"
                      ? "Mark complete"
                      : "Complete occurrence"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      setNotice(null);
                      setDetailId("");
                      setSnoozing(item);
                    }}
                  >
                    <Clock3 size={13} />
                    Snooze
                  </Button>
                </>
              )}
              {editable && item.status !== "Pending" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => act(item, "reopen")}
                >
                  <Undo2 size={13} />
                  Reopen
                </Button>
              )}
              {editable && item.status === "Pending" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setNotice(null);
                    setDetailId("");
                    setCancelling(item);
                  }}
                >
                  <BellOff size={13} />
                  Cancel reminder
                </Button>
              )}
              {editable && item.status === "Pending" && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    setDetailId("");
                    setEditor(item);
                  }}
                >
                  <Pencil size={13} />
                  Edit
                </Button>
              )}
              {!editable && (
                <span className="py-1 text-xs text-muted-foreground">
                  Only the owner, creator or an administrator can make changes.
                </span>
              )}
            </div>
          </div>
        </div>
      </article>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            Workspace / Reminders
          </p>
          <h1 className="text-[28px] font-semibold tracking-tight">
            Reminders
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Keep follow-ups, renewals and deadlines in one place. Complete an
            item when it is done, or snooze its alerts until later.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled} onClick={refresh}>
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button disabled={disabled} onClick={() => setEditor("new")}>
            <Plus size={16} />
            New reminder
          </Button>
        </div>
      </div>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? "error mb-4" : "notice mb-4"}
        >
          {notice.message}
        </p>
      )}
      {missingSelection && (
        <p role="status" className="notice mb-4">
          This reminder is unavailable or you do not have access to it. You can
          still browse your reminders below.
        </p>
      )}

      <section
        className="panel overflow-hidden"
        aria-label="Reminder list"
        aria-busy={disabled}
      >
        <div className="border-b border-border p-4 sm:p-5">
          <div
            className="mb-4 flex flex-wrap gap-2"
            aria-label="Filter reminders"
          >
            {(
              [
                { value: "active", label: "Active" },
                { value: "overdue", label: "Overdue" },
                { value: "completed", label: "Completed" },
                { value: "all", label: "All reminders" },
              ] as const
            ).map((filter) => (
              <Link
                key={filter.value}
                href={listUrl(filter.value, query)}
                aria-current={view === filter.value ? "page" : undefined}
                className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors ${view === filter.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
              >
                {filter.label}
              </Link>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(() => router.push(listUrl(view, search)));
            }}
            role="search"
          >
            <label htmlFor="reminder-search" className="sr-only">
              Search reminder titles
            </label>
            <input
              id="reminder-search"
              type="search"
              placeholder="Search reminder titles…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="outline" disabled={disabled}>
              <Search size={15} />
              Search
            </Button>
            {query && (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setSearch("");
                  startTransition(() => router.push(listUrl(view, "")));
                }}
              >
                Clear search
              </Button>
            )}
          </form>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Times shown in {timezone}.{" "}
            {view === "completed"
              ? "Most recently completed first."
              : "Earliest due date first."}{" "}
            Recurring reminders stay active when you complete an occurrence.
          </p>
        </div>
        {initial.length ? (
          <div className="divide-y divide-border">
            {initial.map((item) => card(item))}
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <BellRing
              size={28}
              className="mx-auto mb-4 text-primary"
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold">
              {query
                ? "No reminders match your search"
                : page > 1
                  ? "No reminders on this page"
                  : view === "overdue"
                    ? "No overdue reminders"
                    : view === "completed"
                      ? "No completed reminders yet"
                      : view === "active"
                        ? "No active reminders"
                        : "Your reminders start here"}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {query
                ? "Try a shorter title or clear your search to see more reminders."
                : view === "overdue"
                  ? "You are up to date. Open Active to see what is coming next."
                  : view === "completed"
                    ? "One-time reminders appear here after you mark them complete."
                    : "Add a follow-up, payment deadline or renewal so you know what needs your attention."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {(query || view !== "active" || page > 1) && (
                <Button variant="outline" asChild>
                  <Link href="/reminders">View active reminders</Link>
                </Button>
              )}
              <Button onClick={() => setEditor("new")} disabled={disabled}>
                <Plus size={15} />
                New reminder
              </Button>
            </div>
          </div>
        )}
        {(initial.length > 0 || page > 1) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">
              Page {page} · {initial.length}{" "}
              {initial.length === 1 ? "reminder" : "reminders"}
              {query ? ` matching “${query}”` : ""}
            </p>
            <nav aria-label="Reminder pages" className="flex gap-2">
              {page > 1 && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={listUrl(view, query, page - 1)}>
                    <ChevronLeft size={14} />
                    Previous
                  </Link>
                </Button>
              )}
              {hasMore && (
                <Button size="sm" variant="outline" asChild>
                  <Link href={listUrl(view, query, page + 1)}>
                    Next
                    <ChevronRight size={14} />
                  </Link>
                </Button>
              )}
            </nav>
          </div>
        )}
      </section>

      {detail && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetailId("");
          }}
        >
          <DialogContent
            title={detail.title}
            description={`Reminder details · times in ${timezone}`}
          >
            {notice?.kind === "error" && (
              <p role="alert" className="error mt-4">
                {notice.message}
              </p>
            )}
            {card(detail, true)}
          </DialogContent>
        </Dialog>
      )}

      {editor && (
        <ReminderEditor
          reminder={editor === "new" ? null : editor}
          policy={policy}
          onClose={() => setEditor(null)}
          onSaved={(isNew, id) => {
            setEditor(null);
            setNotice({
              kind: "success",
              message: isNew ? "Reminder created." : "Reminder updated.",
            });
            if (isNew && id)
              startTransition(() =>
                router.push("/reminders?id=" + encodeURIComponent(id)),
              );
            else refresh();
          }}
        />
      )}

      {snoozing && (
        <SnoozeDialog
          reminder={
            initial.find((item) => item.id === snoozing.id) ||
            (selected?.id === snoozing.id && selected) ||
            snoozing
          }
          policy={policy}
          busy={disabled}
          error={notice?.kind === "error" ? notice.message : ""}
          onClose={() => {
            if (!disabled) setSnoozing(null);
          }}
          onSnooze={(item, until) => act(item, "snooze", until)}
        />
      )}
      {cancelling && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !disabled) setCancelling(null);
          }}
        >
          <DialogContent
            title="Cancel this reminder?"
            description="This stops future alerts and keeps the reminder in All reminders. You can reopen it at any time."
          >
            <p className="mt-5 break-words text-sm font-semibold">
              {cancelling.title}
            </p>
            {notice?.kind === "error" && (
              <p role="alert" className="error mt-4">
                {notice.message}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => setCancelling(null)}
              >
                Keep reminder
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  act(
                    initial.find((item) => item.id === cancelling.id) ||
                      (selected?.id === cancelling.id ? selected : null) ||
                      cancelling,
                    "cancel",
                  )
                }
              >
                {disabled ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <BellOff size={14} />
                )}
                Cancel reminder
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

type Draft = {
  title: string;
  description: string;
  category: string;
  priority: Priority;
  due: string;
  recurrence: Recurrence;
  interval: string;
  advance: string;
  unit: AdvanceUnit;
};

function ReminderEditor({
  reminder,
  policy,
  onClose,
  onSaved,
}: {
  reminder: Reminder | null;
  policy: ReminderPolicy;
  onClose: () => void;
  onSaved: (isNew: boolean, id?: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    title: reminder?.title || "",
    description: reminder?.description || "",
    category: reminder?.category || "General",
    priority: reminder?.priority || "Medium",
    due: toDateTimeLocal(reminder?.due_at || new Date(Date.now() + 3600000)),
    recurrence:
      reminder?.recurrence || policy.reminder_default_recurrence || "none",
    interval: String(reminder?.custom_interval_days || 1),
    advance: String(reminder?.advance_amount || 0),
    unit: reminder?.advance_unit || "days",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const due = fromDateTimeLocal(draft.due);
  const advance = Number(draft.advance);
  let alert: Date | null = null;
  if (due && Number.isInteger(advance) && advance >= 0 && advance <= 10000) {
    try {
      alert = alertAt(due, draft.recurrence, advance, draft.unit, policy);
      if (!Number.isFinite(alert.getTime())) alert = null;
    } catch {
      // Partial or out-of-range dates must not interrupt editing the form.
      alert = null;
    }
  }
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (!due || toDateTimeLocal(due) !== draft.due) {
      setError("Choose a valid date and time in your local timezone.");
      return;
    }
    if (!draft.title.trim()) {
      setError("Give the reminder a title.");
      return;
    }
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await saveReminder({
        ...(reminder
          ? {
              id: reminder.id,
              version: reminder.version,
              owner_id: reminder.owner_id,
              record_id: reminder.record_id,
            }
          : {}),
        title: draft.title.trim(),
        description: draft.description,
        category: draft.category.trim() || "General",
        priority: draft.priority,
        due_at: due,
        recurrence: draft.recurrence,
        custom_interval_days:
          draft.recurrence === "custom" ? Number(draft.interval) : null,
        advance_amount: Number(draft.advance),
        advance_unit: draft.unit,
      });
      if (!result.ok)
        throw Error(
          result.error || "Could not save this reminder. Please try again.",
        );
      onSaved(!reminder, result.id);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save this reminder. Please try again.",
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        title={reminder ? "Edit reminder" : "New reminder"}
        description="Start with a title and due date. Add a repeat schedule or earlier alert if you need one."
      >
        <form onSubmit={submit} className="mt-5 space-y-4" aria-busy={saving}>
          {error && (
            <div role="alert" className="error">
              {error}
              {error.includes("changed") && (
                <p className="mt-2">
                  Close this form, refresh the list and open the latest reminder
                  before editing again.
                </p>
              )}
            </div>
          )}
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <div>
              <label htmlFor="reminder-title">Title *</label>
              <input
                id="reminder-title"
                value={draft.title}
                onChange={(event) => set("title", event.target.value)}
                placeholder="For example, renew the office insurance"
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="reminder-due">Due date and time *</label>
              <input
                id="reminder-due"
                type="datetime-local"
                value={draft.due}
                onChange={(event) => set("due", event.target.value)}
                required
                aria-describedby="reminder-timezone"
              />
              <p
                id="reminder-timezone"
                className="mt-1.5 text-xs text-muted-foreground"
              >
                Enter time in your device timezone: {browserTimezone}.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="reminder-priority">Priority</label>
                <select
                  id="reminder-priority"
                  value={draft.priority}
                  onChange={(event) =>
                    set("priority", event.target.value as Priority)
                  }
                >
                  {priorities.map((priority) => (
                    <option key={priority}>{priority}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reminder-category">Category</label>
                <input
                  id="reminder-category"
                  list="reminder-categories"
                  value={draft.category}
                  maxLength={60}
                  onChange={(event) => set("category", event.target.value)}
                />
                <datalist id="reminder-categories">
                  {categorySuggestions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label htmlFor="reminder-description">
                Notes{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </label>
              <textarea
                id="reminder-description"
                value={draft.description}
                onChange={(event) => set("description", event.target.value)}
                maxLength={5000}
                placeholder="Add any context you will need when this is due."
                rows={3}
              />
            </div>
            <div className="rounded-xl border border-border p-4">
              <label htmlFor="reminder-repeat">Repeat</label>
              <select
                id="reminder-repeat"
                value={draft.recurrence}
                onChange={(event) =>
                  set("recurrence", event.target.value as Recurrence)
                }
              >
                {recurrenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value === "none" ? "Does not repeat" : option.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {
                  recurrenceOptions.find(
                    (option) => option.value === draft.recurrence,
                  )?.hint
                }{" "}
                {draft.recurrence !== "none" &&
                  "Completing an occurrence moves it to the next due date."}
              </p>
              {draft.recurrence === "custom" && (
                <div className="mt-3">
                  <label htmlFor="reminder-interval">
                    Repeat every (days) *
                  </label>
                  <input
                    id="reminder-interval"
                    type="number"
                    min={1}
                    max={3660}
                    step={1}
                    required
                    value={draft.interval}
                    onChange={(event) => set("interval", event.target.value)}
                  />
                </div>
              )}
              <div className="mt-4">
                <label htmlFor="reminder-advance">
                  Alert before the due time
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    id="reminder-advance"
                    type="number"
                    min={0}
                    max={10000}
                    step={1}
                    required
                    value={draft.advance}
                    onChange={(event) => set("advance", event.target.value)}
                  />
                  <select
                    aria-label="Alert advance unit"
                    value={draft.unit}
                    onChange={(event) =>
                      set("unit", event.target.value as AdvanceUnit)
                    }
                  >
                    {advanceUnitOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Use 0 for the company default:{" "}
                  {advanceLabel(
                    draft.recurrence,
                    0,
                    draft.unit,
                    policy,
                  ).toLowerCase()}
                  .
                </p>
              </div>
              {alert && (
                <p className="notice mt-3 text-xs leading-5">
                  First alert: {formatDateTime(alert, browserTimezone)} (
                  {browserTimezone}).
                  {alert.getTime() < Date.now() &&
                    " This time has already passed, so alerts will start on the next reminder check."}
                </p>
              )}
            </div>
          </fieldset>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving
                ? "Saving…"
                : reminder
                  ? "Save changes"
                  : "Create reminder"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SnoozeDialog({
  reminder,
  policy,
  busy,
  error,
  onClose,
  onSnooze,
}: {
  reminder: Reminder;
  policy: ReminderPolicy;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSnooze: (item: Reminder, until: string) => void;
}) {
  const options = snoozeOptions(policy);
  const [minutes, setMinutes] = useState(String(options[0]));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="Snooze reminder"
        description={`Pause alerts for “${reminder.title}”. The due date stays the same.`}
      >
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSnooze(reminder, snoozeUntil(Number(minutes)).toISOString());
          }}
          aria-busy={busy}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div>
            <label htmlFor="reminder-snooze">Remind me again in</label>
            <select
              id="reminder-snooze"
              value={minutes}
              disabled={busy}
              onChange={(event) => setMinutes(event.target.value)}
            >
              {options.map((option) => (
                <option key={option} value={option}>
                  {snoozeLabel(option)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Clock3 size={14} />
              )}
              Snooze alerts
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
