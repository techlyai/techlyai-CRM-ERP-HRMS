"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/modules";
import { grantLeave } from "@/lib/actions";
import { Button } from "./ui/button";
export function LeaveGrant({
  people,
  types,
}: {
  people: Profile[];
  types: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  return (
    <section className="panel mt-6 p-5">
      <h2 className="section-title">Grant leave balance</h2>
      <p className="mt-2 text-xs text-muted-foreground">
        Record compensatory time off or a policy adjustment with an audit
        reason. Scheduled allocations continue according to leave policy.
      </p>
      <form
        className="mt-5 grid items-end gap-3 md:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const requestKey = key || crypto.randomUUID();
          setKey(requestKey);
          const f = new FormData(e.currentTarget);
          const result = await grantLeave({
            user: String(f.get("user")),
            type: String(f.get("type")),
            amount: Number(f.get("amount")),
            reason: String(f.get("reason")),
            key: requestKey,
          });
          setMessage(
            result.ok
              ? "Leave balance granted and recorded in the audit trail."
              : result.error || "Grant failed",
          );
          if (result.ok) {
            setKey("");
            router.refresh();
          }
          setBusy(false);
        }}
      >
        <div>
          <label>Employee *</label>
          <select name="user" required>
            {people
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label>Leave type *</label>
          <select name="type" required defaultValue="Compensatory Off">
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Days to grant *</label>
          <input
            name="amount"
            type="number"
            min="0.5"
            max="365"
            step="0.5"
            required
          />
        </div>
        <div>
          <label>Audit reason *</label>
          <input name="reason" required maxLength={1000} />
        </div>
        <Button disabled={busy}>{busy ? "Recording…" : "Grant balance"}</Button>
      </form>
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
