"use client";
import { useMemo, useState } from "react";
import { Loader2, Search, UserMinus, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  startDirect,
  createGroup,
  updateMembers,
  reportMessage,
} from "@/lib/chat-actions";
import type { DirectoryPerson, Member } from "./helpers";
import type { Result } from "@/lib/actions";
import { PeoplePicker, PersonAvatar, roleLabel } from "./bits";

async function runAction(action: () => Promise<Result>): Promise<Result> {
  try {
    return await action();
  } catch {
    return {
      ok: false,
      error: "Could not connect. Your changes are still here; try again.",
    };
  }
}

export function NewMessageDialog({
  open,
  onOpenChange,
  directory,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryPerson[];
  onStarted: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const term = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      directory.filter(
        (p) =>
          !term ||
          p.full_name.toLowerCase().includes(term) ||
          (p.department || "").toLowerCase().includes(term),
      ),
    [directory, term],
  );
  const start = async (id: string) => {
    setBusy(id);
    setError("");
    const result = await runAction(() => startDirect(id));
    setBusy("");
    if (!result.ok || !result.id) {
      setError(result.error || "Could not start the conversation");
      return;
    }
    onOpenChange(false);
    onStarted(result.id);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="New message"
        description="Choose a colleague to start a direct conversation."
      >
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border px-3">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or department"
            aria-label="Search people"
            className="border-0 bg-transparent px-0 py-2.5 text-[13px] shadow-none focus:shadow-none"
          />
        </div>
        <ul className="mt-3 max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => start(p.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
              >
                <PersonAvatar name={p.full_name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {p.full_name}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[p.department, roleLabel(p.role)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {busy === p.id && (
                  <Loader2 size={14} className="animate-spin text-primary" />
                )}
              </button>
            </li>
          ))}
          {!list.length && (
            <li className="px-3 py-8 text-center text-xs text-muted-foreground">
              {directory.length
                ? "No one matches that search."
                : "No colleagues are available to message under the current chat policy."}
            </li>
          )}
        </ul>
        {error && (
          <p role="alert" className="error mt-3">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NewGroupDialog({
  open,
  onOpenChange,
  directory,
  departments,
  projects,
  isAdmin,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryPerson[];
  departments: string[];
  projects: { id: string; title: string }[];
  isAdmin: boolean;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [department, setDepartment] = useState("");
  const [project, setProject] = useState("");
  const [official, setOfficial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reset = () => {
    setName("");
    setMembers([]);
    setDepartment("");
    setProject("");
    setOfficial(false);
    setError("");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the group a name");
      return;
    }
    setBusy(true);
    setError("");
    const result = await runAction(() =>
      createGroup({
        name: name.trim(),
        members,
        department: department || null,
        project: project || null,
        official: isAdmin && official,
      }),
    );
    setBusy(false);
    if (!result.ok || !result.id) {
      setError(result.error || "Could not create the group");
      return;
    }
    reset();
    onOpenChange(false);
    onCreated(result.id);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        title="New group"
        description="Groups keep a team, department or project in one place. You become the group admin."
      >
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="field">
            <label htmlFor="group-name">Group name *</label>
            <input
              id="group-name"
              autoFocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales desk, Website relaunch"
              required
            />
          </div>
          <div className="field">
            <label>Members</label>
            <PeoplePicker
              people={directory}
              selected={members}
              onChange={setMembers}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="group-department">Department (optional)</label>
              <select
                id="group-department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Everyone in the department is added automatically.
              </p>
            </div>
            <div className="field">
              <label htmlFor="group-project">Project (optional)</label>
              <select
                id="group-project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                The project owner and team join automatically.
              </p>
            </div>
          </div>
          {isAdmin && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-xs font-normal">
              <input
                type="checkbox"
                checked={official}
                onChange={(e) => setOfficial(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck size={13} className="text-primary" /> Official
                  company group
                </span>
                <span className="mt-1 block leading-5 text-muted-foreground">
                  Official groups are always open to Super Admin review, and
                  members see this label.
                </span>
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              Create group
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MembersDialog({
  open,
  onOpenChange,
  conversation,
  members,
  me,
  directory,
  canManage,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: string;
  members: Member[];
  me: string;
  directory: DirectoryPerson[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (input: { add?: string[]; remove?: string[] }) => {
    setBusy(true);
    setError("");
    const result = await runAction(() =>
      updateMembers({ conversation, ...input }),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Could not update members");
      return;
    }
    setAdding([]);
    onChanged();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Members"
        description={`${members.length} ${members.length === 1 ? "person" : "people"} in this group.`}
      >
        <ul className="mt-5 max-h-[40dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <PersonAvatar name={m.name} online={m.online} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {m.name}
                  {m.id === me && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {roleLabel(String(m.role))}
                  {m.group_role === "admin" ? " · Group admin" : ""}
                </span>
              </span>
              {canManage && m.id !== me && (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={"Remove " + m.name}
                  title="Remove from group"
                  onClick={() => run({ remove: [m.id] })}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                >
                  <UserMinus size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <div className="mt-4 space-y-3">
            <label className="mb-0">Add people</label>
            <PeoplePicker
              people={directory}
              selected={adding}
              onChange={setAdding}
              exclude={members.map((m) => m.id)}
              emptyText="Everyone available is already in this group."
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={busy || !adding.length}
                onClick={() => run({ add: adding })}
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                Add {adding.length ? adding.length : ""}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="error mt-3">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ReportDialog({
  messageId,
  onOpenChange,
  onDone,
}: {
  messageId: string | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageId) return;
    setBusy(true);
    setError("");
    const result = await runAction(() => reportMessage(messageId, reason));
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Could not send the report");
      return;
    }
    setReason("");
    onOpenChange(false);
    onDone();
  };
  return (
    <Dialog open={Boolean(messageId)} onOpenChange={onOpenChange}>
      <DialogContent
        title="Report message"
        description="Super Admins are notified and can review the message. The sender is not told who reported it."
      >
        <form onSubmit={submit} className="mt-5 space-y-4">
          <div className="field">
            <label htmlFor="report-reason">
              What is wrong with this message? *
            </label>
            <textarea
              id="report-reason"
              autoFocus
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe the problem briefly"
              className="min-h-[90px]"
            />
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || !reason.trim()}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              Send report
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
