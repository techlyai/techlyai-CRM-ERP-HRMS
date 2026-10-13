"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Send,
  MessageSquare,
  RefreshCw,
  MapPin,
  CalendarClock,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { type BusinessRecord, type Profile, moduleMap } from "@/lib/modules";
import {
  recordAction,
  addQuestion,
  resolveQuestion,
  payment,
  stockMovement,
  shareRecord,
  archiveRecord,
  markQuestionsRead,
  type Result,
} from "@/lib/actions";
import { nextRenewal, money } from "@/lib/domain";
import { Button } from "./ui/button";
import { Status } from "./ui/status";
import { RecordForm, RichText, type Reference } from "./record-form";
import { Attachments, type Attachment } from "./attachments";
import { Dialog, DialogContent } from "./ui/dialog";
import { DocumentReview } from "./document-review";
export type Question = {
  id: string;
  body: string;
  author_id: string;
  parent_id: string | null;
  resolved: boolean;
  created_at: string;
};
type History = {
  id: number;
  action: string;
  actor_id: string;
  created_at: string;
  snapshot: Record<string, unknown>;
};
export function RecordDetails({
  record: r,
  profile,
  people,
  references,
  files,
  questions,
  history,
  payments,
  movements,
  canEdit,
  canApprove,
  canUpload,
}: {
  record: BusinessRecord;
  profile: Profile;
  people: Profile[];
  references: Reference[];
  files: Attachment[];
  questions: Question[];
  history: History[];
  payments: {
    id: string;
    amount: number;
    reference: string;
    method: string;
    created_at: string;
  }[];
  movements: {
    id: string;
    kind: string;
    quantity: number;
    note: string;
    created_at: string;
  }[];
  canEdit: boolean;
  canApprove: boolean;
  canUpload: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState("");
  const [parent, setParent] = useState<string>();
  const [key, setKey] = useState("");
  const [tab, setTab] = useState("details");
  const m = moduleMap[r.module];
  function open(action: string, parentId?: string) {
    setDialog(action);
    setParent(parentId);
    setKey(crypto.randomUUID());
    setError("");
  }
  async function run(fn: () => Promise<Result>) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (!result.ok) setError(result.error || "Action failed");
      else {
        setDialog("");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
    setBusy(false);
  }
  const action = (a: string, note?: string) =>
    recordAction({ id: r.id, version: r.version, action: a, note });
  const editable =
    r.module !== "attendance" &&
    canEdit &&
    (!m.workflow ||
      ["Draft", "Clarification Required", "Rejected"].includes(r.status));
  const review =
    canApprove &&
    r.owner_id !== profile.id &&
    [
      "Submitted",
      "Resubmitted",
      "Clarification Required",
      "Cancellation Requested",
    ].includes(r.status);
  return (
    <>
      <Link
        className="mb-5 flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
        href={"/modules/" + r.module}
      >
        <ArrowLeft size={14} />
        Back to {m.title.toLowerCase()}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            {m.singular} ·{" "}
            {people.find((p) => p.id === r.owner_id)?.full_name ||
              "Assigned employee"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <div className="mt-3 flex items-center gap-3">
            <Status value={r.status} />
            <span className="text-[11px] text-muted-foreground">
              Revision {r.version} · Updated{" "}
              {new Date(r.updated_at).toLocaleString("en-IN")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <RecordForm
              module={r.module}
              people={people}
              references={references}
              record={r}
              canAssign={profile.role === "super_admin"}
            />
          )}{" "}
          {editable && m.workflow && (
            <Button disabled={busy} onClick={() => run(() => action("submit"))}>
              <Send size={14} />
              Submit for review
            </Button>
          )}
          {review && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  run(() =>
                    action(
                      r.status === "Cancellation Requested"
                        ? "cancel_approve"
                        : "approve",
                    ),
                  )
                }
              >
                <Check size={14} />
                {r.status === "Cancellation Requested"
                  ? "Approve cancellation"
                  : "Approve"}
              </Button>
              {r.status !== "Cancellation Requested" && (
                <>
                  <Button variant="outline" onClick={() => open("clarify")}>
                    Ask for clarification
                  </Button>
                  <Button variant="outline" onClick={() => open("reject")}>
                    Reject
                  </Button>
                </>
              )}
            </>
          )}
          {r.module === "leave" &&
            r.owner_id === profile.id &&
            r.status === "Approved" && (
              <Button
                variant="outline"
                onClick={() => run(() => action("cancel_request"))}
              >
                Request cancellation
              </Button>
            )}
          {["renewals", "software"].includes(r.module) && canEdit && (
            <>
              <Button onClick={() => open("renew")}>
                <RefreshCw size={14} />
                Complete renewal
              </Button>
              <Button variant="outline" onClick={() => open("snooze")}>
                <CalendarClock size={14} />
                Snooze
              </Button>
              {["On Hold", "Cancelled"].includes(r.status) ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => run(() => action("resume-renewal"))}
                >
                  Resume reminders
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => run(() => action("hold-renewal"))}
                  >
                    Put on hold
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => open("cancel-renewal")}
                  >
                    Cancel renewal
                  </Button>
                </>
              )}
            </>
          )}
          {r.module === "inventory" && canEdit && (
            <Button onClick={() => open("stock")}>Record stock movement</Button>
          )}
          {r.module === "purchases" &&
            canApprove &&
            r.status === "Approved" && (
              <Button onClick={() => open("receive")}>Receive purchase</Button>
            )}
          {["credit", "purchases", "expenses", "payroll"].includes(r.module) &&
            canApprove &&
            [
              "Approved",
              "Pending Payment",
              "Received",
              "Open",
              "Partially Paid",
            ].includes(r.status) && (
              <Button onClick={() => open("payment")}>Record payment</Button>
            )}
        </div>
      </div>
      {error && !dialog && (
        <p role="alert" className="error mb-5">
          {error}
        </p>
      )}
      <div className="mb-5 flex gap-5 border-b border-border">
        {["details", "conversation", "history"].map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "conversation") markQuestionsRead(r.id);
            }}
            className={`border-b-2 px-1 pb-3 text-xs capitalize ${tab === t ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground"}`}
          >
            {t}
            {t === "conversation" && questions.length > 0
              ? " · " + questions.filter((q) => !q.parent_id).length
              : ""}
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          {tab === "details" && (
            <section className="panel p-5">
              <h2 className="section-title mb-5">Record details</h2>
              <dl className="grid gap-6 md:grid-cols-2">
                {Object.entries(r.data)
                  .filter(
                    ([k]) => !["renewal_history", "team", "lines"].includes(k),
                  )
                  .map(([k, v]) => {
                    const f = m.fields.find((f) => f.key === k);
                    const isText = f?.type === "textarea";
                    return (
                      <div key={k} className={isText ? "md:col-span-2" : ""}>
                        <dt className="mb-2 text-[11px] capitalize text-muted-foreground">
                          {f?.label.replace(" *", "") || k.replaceAll("_", " ")}
                        </dt>
                        <dd>
                          {isText ? (
                            <RichText text={String(v || "—")} />
                          ) : k === "sheet_url" || k === "link" ? (
                            <a
                              className="break-all text-xs text-primary underline"
                              href={String(v)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open shared link
                            </a>
                          ) : (
                            <span className="break-words text-sm">
                              {v === null || v === undefined || v === ""
                                ? "—"
                                : typeof v === "boolean"
                                  ? v
                                    ? "Yes"
                                    : "No"
                                  : typeof v === "object"
                                    ? JSON.stringify(v)
                                    : k === "amount" ||
                                        k === "budget" ||
                                        k === "paid_amount" ||
                                        k === "salary"
                                      ? money(v)
                                      : String(v)}
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
              </dl>
              {Array.isArray(r.data.lines) && (
                <div className="mt-5 border-t pt-4">
                  <h3 className="text-xs font-semibold">Purchase items</h3>
                  {r.data.lines.map((line, i) => {
                    const l = line as {
                      item_id: string;
                      quantity: number;
                      unit_cost: number;
                    };
                    return (
                      <p key={i} className="mt-2 text-sm">
                        {references.find((x) => x.id === l.item_id)?.title ||
                          "Stock item"}{" "}
                        · {l.quantity} × {money(l.unit_cost)}
                      </p>
                    );
                  })}
                </div>
              )}
              {Array.isArray(r.data.team) && (
                <div className="mt-5 border-t pt-4">
                  <h3 className="text-xs font-semibold">Project team</h3>
                  <p className="mt-2 text-sm">
                    {r.data.team
                      .map(
                        (id) =>
                          people.find((p) => p.id === id)?.full_name ||
                          "Assigned colleague",
                      )
                      .join(", ")}
                  </p>
                </div>
              )}
              {r.module === "attendance" &&
                r.data.lat !== null &&
                r.data.lat !== undefined && (
                  <a
                    className="mt-5 inline-flex items-center gap-2 text-xs text-primary"
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.openstreetmap.org/?mlat=${Number(r.data.lat)}&mlon=${Number(r.data.lng)}#map=17/${Number(r.data.lat)}/${Number(r.data.lng)}`}
                  >
                    <MapPin size={14} />
                    View check-in location on map
                  </a>
                )}
            </section>
          )}
          {tab === "conversation" && (
            <section className="panel p-5">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="section-title">Questions & clarification</h2>
                {canApprove && (
                  <Button size="sm" onClick={() => open("question")}>
                    <MessageSquare size={13} />
                    Ask a question
                  </Button>
                )}
              </div>
              {!questions.length && (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  Questions and replies stay connected to this record.
                </p>
              )}
              {questions
                .filter((q) => !q.parent_id)
                .map((q) => (
                  <div key={q.id} className="mb-5 rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold">
                        {people.find((p) => p.id === q.author_id)?.full_name ||
                          "Reviewer"}
                      </span>
                      <Status
                        value={
                          q.resolved ? "Completed" : "Clarification Required"
                        }
                      />
                    </div>
                    <div className="mt-3">
                      <RichText text={q.body} />
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {new Date(q.created_at).toLocaleString("en-IN")}
                    </p>
                    {questions
                      .filter((reply) => reply.parent_id === q.id)
                      .map((reply) => (
                        <div
                          key={reply.id}
                          className="mt-4 border-l-2 border-primary/20 pl-4"
                        >
                          <p className="mb-1 text-xs font-semibold">
                            {people.find((p) => p.id === reply.author_id)
                              ?.full_name || "Colleague"}
                          </p>
                          <RichText text={reply.body} />
                          <p className="mt-2 text-[10px] text-muted-foreground">
                            {new Date(reply.created_at).toLocaleString("en-IN")}
                          </p>
                        </div>
                      ))}
                    <div className="mt-4 flex gap-2">
                      {(canEdit || canApprove) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => open("reply", q.id)}
                        >
                          Reply
                        </Button>
                      )}
                      {canApprove && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            run(() => resolveQuestion(q.id, !q.resolved))
                          }
                        >
                          {q.resolved ? "Reopen" : "Mark resolved"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
            </section>
          )}
          {tab === "history" && (
            <section className="panel p-5">
              <h2 className="section-title mb-5">Complete revision history</h2>
              <div className="space-y-4">
                {history.map((h) => (
                  <div className="border-l-2 border-primary/20 pl-4" key={h.id}>
                    <p className="text-xs font-semibold">
                      {h.action} ·{" "}
                      {people.find((p) => p.id === h.actor_id)?.full_name ||
                        "System"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(h.created_at).toLocaleString("en-IN")}
                    </p>
                    {Boolean(h.snapshot?.note) && (
                      <p className="mt-2 text-sm">{String(h.snapshot.note)}</p>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[10px] text-primary">
                        View recorded revision
                      </summary>
                      <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-muted p-3 text-[10px]">
                        {JSON.stringify(h.snapshot, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            </section>
          )}
          {payments.length > 0 && (
            <section className="panel p-5">
              <h2 className="section-title mb-4">Payment history</h2>
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex justify-between border-t py-3 text-xs"
                >
                  <div>
                    <p className="font-medium">
                      {p.method} · {p.reference}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <p className="font-semibold">{money(p.amount)}</p>
                </div>
              ))}
            </section>
          )}
          {movements.length > 0 && (
            <section className="panel p-5">
              <h2 className="section-title mb-4">Immutable stock history</h2>
              {movements.map((x) => (
                <div key={x.id} className="border-t py-3 text-xs">
                  <p className="font-medium">
                    {x.kind} · {x.quantity} units
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {x.note} · {new Date(x.created_at).toLocaleString("en-IN")}
                  </p>
                </div>
              ))}
            </section>
          )}
        </div>
        <div className="space-y-5">
          <Attachments record={r.id} files={files} canUpload={canUpload} />
          <DocumentReview
            files={files}
            canApprove={canApprove}
            actor={profile.id}
          />
          {profile.role === "super_admin" && (
            <section className="panel p-5">
              <h2 className="section-title">Record access</h2>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Share this record with a colleague who has View access to this
                module.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => open("share")}
              >
                Share with colleague
              </Button>
              {[
                "Draft",
                "New Lead",
                "Planning",
                "Applied",
                "To Do",
                "Inactive",
              ].includes(r.status) &&
                !["attendance", "inventory", "credit"].includes(r.module) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 mt-4 text-danger"
                    onClick={() => open("archive")}
                  >
                    Archive record
                  </Button>
                )}
            </section>
          )}
          {r.data.flagged === true && (
            <p className="error mt-5">
              This check-in was flagged for review because the reported location
              or accuracy falls outside office policy.
            </p>
          )}
        </div>
      </div>
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open) setDialog("");
        }}
      >
        <DialogContent
          title={
            dialog === "share"
              ? "Share record"
              : dialog === "archive"
                ? "Archive record"
                : dialog === "receive"
                  ? "Confirm purchase receipt"
                  : dialog === "payment"
                    ? "Record a payment"
                    : dialog === "stock"
                      ? "Record stock movement"
                      : dialog === "renew"
                        ? "Complete renewal"
                        : dialog === "snooze"
                          ? "Snooze reminders"
                          : dialog === "reject"
                            ? "Reject with a reason"
                            : dialog === "clarify"
                              ? "Request clarification"
                              : dialog === "reply"
                                ? "Reply to question"
                                : "Ask a question"
          }
        >
          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              run(async () => {
                if (["question", "reply"].includes(dialog))
                  return addQuestion(r.id, String(data.get("note")), parent);
                if (dialog === "share")
                  return shareRecord(r.id, String(data.get("employee")));
                if (dialog === "archive") return archiveRecord(r.id, r.version);
                if (dialog === "payment")
                  return payment({
                    id: r.id,
                    amount: Number(data.get("amount")),
                    method: String(data.get("method")),
                    reference: String(data.get("reference")),
                    key,
                  });
                if (dialog === "stock")
                  return stockMovement({
                    item: r.id,
                    kind: String(data.get("kind")),
                    quantity: Number(data.get("quantity")),
                    employee: String(data.get("employee") || ""),
                    location: String(data.get("location") || ""),
                    note: String(data.get("note")),
                    key,
                  });
                if (dialog === "renew")
                  return recordAction({
                    id: r.id,
                    version: r.version,
                    action: "renew",
                    expiry: String(data.get("expiry")),
                  });
                if (dialog === "snooze")
                  return recordAction({
                    id: r.id,
                    version: r.version,
                    action: "snooze",
                    until: String(data.get("until")),
                  });
                return action(dialog, String(data.get("note") || ""));
              });
            }}
          >
            {dialog === "share" && (
              <div>
                <label>Share with employee</label>
                <select name="employee" required>
                  <option value="">Select colleague</option>
                  {people
                    .filter((p) => p.active && p.id !== r.owner_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {dialog === "cancel-renewal" && (
              <p className="text-sm text-muted-foreground">
                Cancel this renewal and stop reminders? The renewal history will
                be preserved.
              </p>
            )}
            {dialog === "archive" && (
              <p className="text-sm leading-6 text-muted-foreground">
                Archive this draft or inactive record? Its audit history will be
                preserved and it will be removed from active lists.
              </p>
            )}
            {["clarify", "reject", "question", "reply", "stock"].includes(
              dialog,
            ) && (
              <div>
                <label htmlFor="note">
                  {dialog === "reject" ? "Reason" : "Message / supporting note"}{" "}
                  *
                </label>
                <textarea id="note" name="note" required />
              </div>
            )}
            {dialog === "payment" && (
              <>
                <div>
                  <label>Amount *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    name="amount"
                    required
                  />
                </div>
                <div>
                  <label>Payment method *</label>
                  <select name="method" required>
                    {["Bank transfer", "UPI", "Cash", "Card", "Cheque"].map(
                      (s) => (
                        <option key={s}>{s}</option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label>Transaction reference *</label>
                  <input name="reference" required />
                </div>
                <p className="text-xs text-muted-foreground">
                  Payments are recorded once and cannot exceed the outstanding
                  amount.
                </p>
              </>
            )}
            {dialog === "stock" && (
              <>
                <div>
                  <label>Movement type</label>
                  <select name="kind">
                    {[
                      "Purchase",
                      "Allocation",
                      "Return",
                      "Transfer",
                      "Damage",
                      "Disposal",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Quantity *</label>
                  <input
                    name="quantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                  />
                </div>
                <div>
                  <label>Employee (required for allocations and returns)</label>
                  <select name="employee">
                    <option value="">Select employee</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Destination (for stock transfer)</label>
                  <input name="location" />
                </div>
              </>
            )}
            {dialog === "renew" && (
              <div>
                <label>New expiration date *</label>
                <input
                  name="expiry"
                  type="date"
                  required
                  defaultValue={nextRenewal(
                    String(r.data.expiry_date),
                    String(r.data.frequency),
                    Number(r.data.custom_days),
                  )}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  The previous cycle stays in renewal history. Reminders will
                  follow the new date.
                </p>
              </div>
            )}
            {dialog === "snooze" && (
              <div>
                <label>Remind me again on *</label>
                <input
                  name="until"
                  type="date"
                  required
                  defaultValue={new Date(Date.now() + 7 * 86400000)
                    .toISOString()
                    .slice(0, 10)}
                />
              </div>
            )}
            {dialog === "receive" && (
              <p className="text-sm leading-6 text-muted-foreground">
                Confirm that this purchase has been delivered. The items will be
                added to stock and a linked expense entry will be created in one
                transaction.
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Button disabled={busy} type="submit">
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
