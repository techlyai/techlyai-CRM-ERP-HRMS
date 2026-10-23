"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CompanySettings } from "@/components/settings";
import { saveSettings } from "@/lib/actions";

export function ChatPolicySettings({
  settings,
  onSaved,
}: {
  settings: CompanySettings;
  onSaved?: (settings: CompanySettings) => void;
}) {
  const router = useRouter();
  const [policy, setPolicy] = useState<CompanySettings["chat"]>(
    settings.chat || {
      group_creation: "managers",
      direct_messages: "everyone",
      edit_minutes: 15,
      admin_review: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const change = (patch: Partial<CompanySettings["chat"]>) => {
    setPolicy((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const next = { ...settings, chat: policy };
      const result = await saveSettings(next);
      if (!result.ok)
        throw Error(result.error || "Could not save the chat policy.");
      onSaved?.(next);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the chat policy. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="panel max-w-3xl space-y-5 p-6">
      <div>
        <h2 className="section-title">Team chat policy</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose who can start conversations and how messages can be managed.
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-5">
        <div className="field">
          <label htmlFor="chat-groups">Who can create groups?</label>
          <select
            id="chat-groups"
            value={policy.group_creation}
            onChange={(event) =>
              change({
                group_creation: event.target
                  .value as CompanySettings["chat"]["group_creation"],
              })
            }
          >
            <option value="admins">Super Admins only</option>
            <option value="managers">Super Admins and managers</option>
            <option value="everyone">Everyone</option>
          </select>
          <p className="text-xs leading-5 text-muted-foreground">
            The person who creates a group can manage its members.
          </p>
        </div>
        <div className="field">
          <label htmlFor="chat-direct">
            Who can employees message directly?
          </label>
          <select
            id="chat-direct"
            value={policy.direct_messages}
            onChange={(event) =>
              change({
                direct_messages: event.target
                  .value as CompanySettings["chat"]["direct_messages"],
              })
            }
          >
            <option value="everyone">Any colleague</option>
            <option value="team">Their team and department</option>
          </select>
          <p className="text-xs leading-5 text-muted-foreground">
            Team access includes colleagues with the same manager or department.
            Employees can always contact managers and Super Admins.
          </p>
        </div>
        <div className="field">
          <label htmlFor="chat-edit">Message editing window (minutes)</label>
          <input
            id="chat-edit"
            type="number"
            min={-1}
            max={1440}
            step={1}
            required
            value={
              Number.isFinite(policy.edit_minutes) ? policy.edit_minutes : ""
            }
            onChange={(event) =>
              change({ edit_minutes: event.target.valueAsNumber })
            }
            aria-describedby="chat-edit-help"
          />
          <p
            id="chat-edit-help"
            className="text-xs leading-5 text-muted-foreground"
          >
            Use 0 to disable editing, -1 for no time limit, or 1–1,440 minutes
            after a message is sent.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 text-sm font-normal">
          <input
            type="checkbox"
            className="mt-1"
            checked={policy.admin_review}
            onChange={(event) => change({ admin_review: event.target.checked })}
          />
          <span>
            <span className="flex items-center gap-2 font-semibold">
              <ShieldCheck size={16} />
              Allow Super Admins to review all conversations
            </span>
            <span className="mt-2 block text-xs leading-5 text-muted-foreground">
              This includes direct messages and private groups. Review access is
              recorded. Official company groups are always available for Super
              Admin review.
            </span>
          </span>
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          Chat policy saved.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "Saving…" : "Save chat policy"}
        </Button>
      </div>
    </form>
  );
}
