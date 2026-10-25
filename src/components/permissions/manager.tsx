"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  FileStack,
  History,
  Loader2,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";
import {
  PermissionChecklist,
  diffPermissions,
  keyOf,
  type PermissionDefinition,
  type PermissionState,
} from "./checklist";
import {
  applyPermissionTemplate,
  deletePermissionTemplate,
  loadEffectivePermissions,
  resetUserPermissions,
  savePermissionTemplate,
  saveRolePermissions,
  saveUserPermissions,
} from "@/lib/permission-actions";
import { roleDescriptions, roleLabel, scopeLabels, type Role, type Scope } from "@/lib/roles";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";

export type Person = {
  id: string;
  full_name: string;
  employee_id: string | null;
  department: string | null;
  designation: string | null;
  role: Role;
  active: boolean;
  overrides: number;
};
export type Effective = { module: string; action: string; scope: Scope; role_scope: Scope; override_scope: Scope | null };
export type AuditEntry = {
  id: number;
  actor_id: string;
  source: string;
  changes: { module: string; action: string; before: Scope; after: Scope }[];
  reason: string;
  created_at: string;
};
export type Template = { id: string; name: string; description: string; items: { module: string; action: string; scope: Scope }[]; created_by: string; updated_at: string };
type Tab = "employees" | "roles" | "templates";

const when = (v: string) =>
  new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const toState = (rows: { module: string; action: string; scope: string }[]): PermissionState =>
  Object.fromEntries(rows.map((r) => [keyOf(r), r.scope as Scope]));
const toItems = (defs: PermissionDefinition[], state: PermissionState) =>
  defs.map((d) => ({ module: d.module, action: d.action, scope: state[keyOf(d)] || "none" }));
const sourceLabel: Record<string, string> = {
  user: "Edited",
  role: "Role default changed",
  template: "Template applied",
  reset: "Reset to role defaults",
  copy: "Copied from another user",
};

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-success/30 bg-card px-4 py-2 text-xs font-medium shadow-lg lg:bottom-6">
      <Check size={14} className="text-success" />
      {text}
    </div>
  );
}

export function PermissionsManager({
  me,
  definitions,
  delegable,
  people,
  selected,
  roleDefaults,
  templates,
  initialTab,
}: {
  me: { id: string; role: Role };
  definitions: PermissionDefinition[];
  /** Null for Super Admins (unrestricted). */
  delegable: PermissionState | null;
  people: Person[];
  selected: { person: Person; effective: Effective[]; audit: AuditEntry[] } | null;
  roleDefaults: { role: string; module: string; action: string; scope: Scope }[];
  templates: Template[];
  initialTab: Tab;
}) {
  const router = useRouter();
  const superAdmin = me.role === "super_admin";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [toast, setToast] = useState("");
  const names = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p.full_name])), [people]);
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="text-primary" /> Enforced by the server on every request
          </p>
          <h1 className="text-2xl font-semibold">Roles & permissions</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Choose exactly which pages and actions each person can use, and how far their access reaches.
            {superAdmin ? "" : " You can only grant permissions you hold yourself."}
          </p>
        </div>
      </div>
      <div className="mb-6 flex gap-5 border-b border-border" role="tablist">
        {(
          [
            ["employees", "Employee permissions"],
            ...(superAdmin ? [["roles", "Role defaults"]] : []),
            ["templates", "Templates"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-1 pb-3 text-xs ${tab === t ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "employees" && (
        <EmployeePermissions
          me={me}
          definitions={definitions}
          delegable={delegable}
          people={people}
          selected={selected}
          templates={templates}
          names={names}
          onSaved={(t) => {
            setToast(t);
            router.refresh();
          }}
        />
      )}
      {tab === "roles" && superAdmin && (
        <RoleDefaults
          definitions={definitions}
          roleDefaults={roleDefaults}
          people={people}
          onSaved={(t) => {
            setToast(t);
            router.refresh();
          }}
        />
      )}
      {tab === "templates" && (
        <Templates
          definitions={definitions}
          delegable={delegable}
          templates={templates}
          people={people.filter((p) => p.role !== "super_admin" && p.id !== me.id)}
          names={names}
          onSaved={(t) => {
            setToast(t);
            router.refresh();
          }}
        />
      )}
      {toast && <Toast text={toast} onDone={() => setToast("")} />}
    </div>
  );
}

function EmployeePermissions({
  me,
  definitions,
  delegable,
  people,
  selected,
  templates,
  names,
  onSaved,
}: {
  me: { id: string; role: Role };
  definitions: PermissionDefinition[];
  delegable: PermissionState | null;
  people: Person[];
  selected: { person: Person; effective: Effective[]; audit: AuditEntry[] } | null;
  templates: Template[];
  names: Record<string, string>;
  onSaved: (text: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [dept, setDept] = useState("");
  const initial = useMemo(() => toState(selected?.effective || []), [selected]);
  const inherited = useMemo(
    () => Object.fromEntries((selected?.effective || []).map((e) => [keyOf(e), e.role_scope])) as PermissionState,
    [selected],
  );
  const [state, setState] = useState<PermissionState>(initial);
  useEffect(() => setState(initial), [initial]);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [templateDialog, setTemplateDialog] = useState(false);
  const changes = diffPermissions(definitions, initial, state);
  const dirty = changes.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const departments = [...new Set(people.map((p) => p.department).filter(Boolean))] as string[];
  const q = query.trim().toLowerCase();
  const list = people.filter(
    (p) =>
      (!q || p.full_name.toLowerCase().includes(q) || (p.employee_id || "").toLowerCase().includes(q)) &&
      (!role || p.role === role) &&
      (!dept || p.department === dept),
  );
  const target = selected?.person;
  const locked = !target ? "" : target.role === "super_admin"
    ? "Super Admins always have full access. Their permissions cannot be restricted."
    : target.id === me.id && me.role !== "super_admin"
      ? "You cannot change your own permissions. Ask a Super Admin."
      : "";
  const editable = (d: PermissionDefinition) => !delegable || (delegable[keyOf(d)] || "none") !== "none";
  const open = (id: string) => {
    if (dirty && !window.confirm("Discard unsaved permission changes?")) return;
    router.push("/settings/roles?user=" + id, { scroll: false });
  };
  async function save() {
    if (!target) return;
    setBusy(true);
    setError("");
    const r = await saveUserPermissions({
      user: target.id,
      items: changes.map((c) => ({ module: c.def.module, action: c.def.action, scope: c.after })),
      reason,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not save permissions");
    setConfirm(false);
    setReason("");
    onSaved(`Permissions saved for ${target.full_name}`);
  }
  async function reset() {
    if (!target || !window.confirm(`Reset ${target.full_name} to the ${roleLabel(target.role)} role defaults? Individual overrides you are allowed to change will be removed.`)) return;
    setBusy(true);
    const r = await resetUserPermissions({ user: target.id, reason: "Reset to role defaults" });
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not reset");
    onSaved(`${target.full_name} now uses the role defaults`);
  }
  async function copy(from: string) {
    setCopyFrom(from);
    if (!from) return;
    const r = await loadEffectivePermissions(from);
    if (!r.ok || !r.data) return setError(r.error || "Could not load that person's access");
    const src = toState(r.data);
    // Only permissions this editor may change are copied.
    setState({ ...state, ...Object.fromEntries(definitions.filter(editable).map((d) => [keyOf(d), src[keyOf(d)] || "none"])) });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
      <aside className="panel h-fit p-4 xl:sticky xl:top-24">
        <div className="mb-3 flex items-center gap-2">
          <Users size={16} className="text-primary" />
          <h2 className="section-title">Select a person</h2>
        </div>
        <label className="relative block">
          <span className="sr-only">Search by name or employee ID</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or employee ID" className="h-10 pl-9" />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className="h-9 text-xs">
            <option value="">All roles</option>
            <option value="super_admin">Super Admin</option>
            <option value="manager">Admin</option>
            <option value="employee">Employee</option>
          </select>
          <select aria-label="Filter by department" value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 text-xs">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
        <ul className="scroll-thin mt-3 max-h-[60vh] space-y-1 overflow-y-auto pr-1">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => open(p.id)}
                aria-current={target?.id === p.id}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${target?.id === p.id ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{p.full_name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${p.role === "super_admin" ? "bg-primary/15 text-primary" : p.role === "manager" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {roleLabel(p.role)}
                  </span>
                </span>
                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {[p.employee_id, p.department, p.designation].filter(Boolean).join(" · ") || "No department"}
                </span>
                <span className="mt-1 flex gap-2 text-[10px] text-muted-foreground">
                  {!p.active && <span className="text-danger">Inactive</span>}
                  <span>{p.role === "super_admin" ? "Full access" : p.overrides ? `${p.overrides} individual override${p.overrides === 1 ? "" : "s"}` : "Role defaults"}</span>
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="py-6 text-center text-xs text-muted-foreground">No people match these filters.</li>}
        </ul>
      </aside>

      <section className="min-w-0">
        {!target ? (
          <div className="panel flex flex-col items-center px-6 py-16 text-center">
            <div className="icon-tile mb-4 h-12 w-12 rounded-xl">
              <ShieldCheck size={22} />
            </div>
            <p className="text-sm font-semibold">Select a person to manage their access</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              Their current permissions load as a checklist. Changes apply on the server as soon as you save.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{target.full_name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[target.employee_id, roleLabel(target.role), target.department, target.designation, target.active ? "Active" : "Inactive"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-md bg-success/10 px-2 py-1 font-medium text-success">
                    {Object.values(state).filter((s) => s !== "none").length} granted
                  </span>
                  <span className="rounded-md bg-primary/10 px-2 py-1 font-medium text-primary">
                    {(selected?.effective || []).filter((e) => e.override_scope !== null).length} overrides
                  </span>
                  {dirty && <span className="rounded-md bg-warning/10 px-2 py-1 font-medium text-warning">{changes.length} unsaved changes</span>}
                </div>
              </div>
              {locked ? (
                <p className="notice mt-4 text-xs">{locked}</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button size="sm" variant="outline" onClick={() => setState({ ...state, ...Object.fromEntries(definitions.filter(editable).filter((d) => (state[keyOf(d)] || "none") === "none").map((d) => [keyOf(d), d.scoped ? "self" : "all"])) })}>
                    Select all
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setState({ ...state, ...Object.fromEntries(definitions.filter(editable).map((d) => [keyOf(d), "none" as Scope])) })}>
                    Clear all
                  </Button>
                  <Button size="sm" variant="outline" onClick={reset} disabled={busy}>
                    <RotateCcw size={13} /> Reset to role defaults
                  </Button>
                  <select aria-label="Copy permissions from another person" value={copyFrom} onChange={(e) => copy(e.target.value)} className="h-8 w-auto py-0 text-xs">
                    <option value="">Copy from…</option>
                    {people.filter((p) => p.id !== target.id).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Load a template"
                    value=""
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value);
                      if (!t) return;
                      const src = toState(t.items);
                      setState({ ...state, ...Object.fromEntries(definitions.filter(editable).map((d) => [keyOf(d), src[keyOf(d)] || "none"])) });
                    }}
                    className="h-8 w-auto py-0 text-xs"
                  >
                    <option value="">Load template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => setTemplateDialog(true)}>
                    <FileStack size={13} /> Save as template
                  </Button>
                </div>
              )}
            </div>

            {error && <p role="alert" className="error">{error}</p>}

            <div className={`panel p-4 sm:p-5 ${locked ? "pointer-events-none opacity-60" : ""}`}>
              <PermissionChecklist
                definitions={definitions}
                value={state}
                onChange={setState}
                max={delegable}
                inherited={inherited}
                initial={initial}
              />
            </div>

            {!locked && (
              <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-soft backdrop-blur lg:bottom-4">
                <span className="mr-auto text-xs text-muted-foreground">
                  {dirty ? `${changes.length} change${changes.length === 1 ? "" : "s"} not saved` : "All changes saved"}
                </span>
                <Button variant="outline" disabled={!dirty || busy} onClick={() => setState(initial)}>
                  <Undo2 size={14} /> Cancel changes
                </Button>
                <Button disabled={!dirty || busy} onClick={() => setConfirm(true)}>
                  <Save size={14} /> Save permissions
                </Button>
              </div>
            )}

            <HistoryPanel audit={selected?.audit || []} definitions={definitions} names={names} />
          </div>
        )}
      </section>

      {confirm && target && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)}>
          <DialogContent title={`Confirm changes for ${target.full_name}`} description="Review what will be granted or revoked. Changes take effect immediately.">
            <ChangeSummary changes={changes} />
            <div className="mt-4">
              <label htmlFor="perm-reason">Reason (recorded in the permission history)</label>
              <input id="perm-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Moved to the CRM team" />
            </div>
            {error && <p role="alert" className="error mt-3">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(false)}>Back</Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />} Save permissions
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {templateDialog && (
        <TemplateDialog
          definitions={definitions}
          initialItems={toItems(definitions, state)}
          onClose={() => setTemplateDialog(false)}
          onSaved={() => {
            setTemplateDialog(false);
            onSaved("Template saved");
          }}
        />
      )}
    </div>
  );
}

function ChangeSummary({ changes }: { changes: ReturnType<typeof diffPermissions> }) {
  const groups = [
    ["granted", "Granted", "text-success"],
    ["changed", "Scope changed", "text-primary"],
    ["revoked", "Revoked", "text-danger"],
  ] as const;
  return (
    <div className="mt-4 max-h-[45vh] space-y-4 overflow-y-auto">
      {groups.map(([kind, title, tone]) => {
        const list = changes.filter((c) => c.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind}>
            <p className={`mb-1.5 text-xs font-semibold ${tone}`}>{title} ({list.length})</p>
            <ul className="space-y-1 text-xs">
              {list.map((c) => (
                <li key={keyOf(c.def)} className="flex flex-wrap justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5">
                  <span>{c.def.module_label} · {c.def.label}</span>
                  <span className="text-muted-foreground">{scopeLabels[c.before]} → {scopeLabels[c.after]}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function HistoryPanel({ audit, definitions, names }: { audit: AuditEntry[]; definitions: PermissionDefinition[]; names: Record<string, string> }) {
  const label = Object.fromEntries(definitions.map((d) => [keyOf(d), `${d.module_label} · ${d.label}`]));
  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center gap-2">
        <History size={16} className="text-primary" />
        <h2 className="section-title">Permission history</h2>
      </div>
      {!audit.length ? (
        <p className="text-xs text-muted-foreground">No permission changes recorded for this person yet.</p>
      ) : (
        <ol className="space-y-4">
          {audit.map((a) => (
            <li key={a.id} className="border-l-2 border-primary/20 pl-4">
              <p className="text-xs font-semibold">
                {sourceLabel[a.source] || a.source} · {names[a.actor_id] || "Unknown"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {when(a.created_at)}
                {a.reason ? ` · ${a.reason}` : ""}
              </p>
              <ul className="mt-2 space-y-0.5 text-[11px]">
                {a.changes.slice(0, 12).map((c) => (
                  <li key={c.module + c.action}>
                    {label[`${c.module}.${c.action}`] || `${c.module}.${c.action}`}:{" "}
                    <span className="text-muted-foreground">{scopeLabels[c.before]} → </span>
                    <span className={c.after === "none" ? "text-danger" : "text-success"}>{scopeLabels[c.after]}</span>
                  </li>
                ))}
                {a.changes.length > 12 && <li className="text-muted-foreground">and {a.changes.length - 12} more</li>}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RoleDefaults({
  definitions,
  roleDefaults,
  people,
  onSaved,
}: {
  definitions: PermissionDefinition[];
  roleDefaults: { role: string; module: string; action: string; scope: Scope }[];
  people: Person[];
  onSaved: (text: string) => void;
}) {
  const [role, setRole] = useState<"manager" | "employee">("employee");
  const initial = useMemo(() => toState(roleDefaults.filter((r) => r.role === role)), [roleDefaults, role]);
  const [state, setState] = useState<PermissionState>(initial);
  useEffect(() => setState(initial), [initial]);
  const [confirm, setConfirm] = useState(false);
  const [apply, setApply] = useState<"all" | "new_only">("all");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = diffPermissions(definitions, initial, state);
  const count = (r: Role) => people.filter((p) => p.role === r).length;
  async function save() {
    setBusy(true);
    setError("");
    const r = await saveRolePermissions({
      role,
      items: changes.map((c) => ({ module: c.def.module, action: c.def.action, scope: c.after })),
      apply,
      reason,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error || "Could not save role defaults");
    setConfirm(false);
    setReason("");
    onSaved(`${roleLabel(role)} defaults saved`);
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {(["super_admin", "manager", "employee"] as Role[]).map((r) => (
          <button
            key={r}
            type="button"
            disabled={r === "super_admin"}
            onClick={() => r !== "super_admin" && setRole(r)}
            className={`panel p-4 text-left transition-colors ${role === r ? "border-primary/50 ring-1 ring-primary/30" : ""} ${r === "super_admin" ? "cursor-default" : "hover:border-primary/30"}`}
          >
            <span className="flex items-center justify-between">
              <span className="text-sm font-semibold">{roleLabel(r)}</span>
              <span className="text-[11px] text-muted-foreground">{count(r)} people</span>
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{roleDescriptions[r]}</span>
            {r === "super_admin" && (
              <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-primary">
                <ShieldCheck size={11} /> Protected
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="panel p-4 sm:p-5">
        <p className="mb-4 text-xs text-muted-foreground">
          Defaults for every {roleLabel(role)}. People inherit these unless they have an individual override.
        </p>
        <PermissionChecklist definitions={definitions} value={state} onChange={setState} max={null} initial={initial} />
      </div>
      <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-soft backdrop-blur lg:bottom-4">
        <span className="mr-auto text-xs text-muted-foreground">
          {changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} not saved` : "All changes saved"}
        </span>
        <Button variant="outline" disabled={!changes.length} onClick={() => setState(initial)}>
          <Undo2 size={14} /> Cancel changes
        </Button>
        <Button disabled={!changes.length} onClick={() => setConfirm(true)}>
          <Save size={14} /> Save {roleLabel(role)} defaults
        </Button>
      </div>
      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(false)}>
          <DialogContent title={`Change ${roleLabel(role)} defaults`} description="Choose who the change applies to. Individual overrides are always kept.">
            <ChangeSummary changes={changes} />
            <fieldset className="mt-4 space-y-2">
              <label className="mb-0 flex items-start gap-2 text-xs font-normal">
                <input type="radio" name="apply" checked={apply === "all"} onChange={() => setApply("all")} className="mt-0.5 w-auto" />
                <span>
                  <strong>Everyone who inherits the default.</strong> Existing {roleLabel(role)}s without an override get the new access now.
                </span>
              </label>
              <label className="mb-0 flex items-start gap-2 text-xs font-normal">
                <input type="radio" name="apply" checked={apply === "new_only"} onChange={() => setApply("new_only")} className="mt-0.5 w-auto" />
                <span>
                  <strong>New people only.</strong> Existing {roleLabel(role)}s keep their current access, recorded as individual overrides.
                </span>
              </label>
            </fieldset>
            <div className="mt-4">
              <label htmlFor="role-reason">Reason</label>
              <input id="role-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
            {error && <p role="alert" className="error mt-3">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(false)}>Back</Button>
              <Button onClick={save} disabled={busy}>
                {busy && <Loader2 size={14} className="animate-spin" />} Save defaults
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function TemplateDialog({
  definitions,
  initialItems,
  template,
  onClose,
  onSaved,
}: {
  definitions: PermissionDefinition[];
  initialItems: { module: string; action: string; scope: Scope }[];
  template?: Template;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [state, setState] = useState<PermissionState>(toState(template?.items || initialItems));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={template ? `Edit template · ${template.name}` : "Save as template"} description="Templates hold a complete set of permissions you can apply to many people at once.">
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tpl-name">Template name *</label>
            <input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="CRM executive" />
          </div>
          <div>
            <label htmlFor="tpl-desc">Description</label>
            <input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
        </div>
        {template && (
          <div className="mt-4">
            <PermissionChecklist definitions={definitions} value={state} onChange={setState} max={null} />
          </div>
        )}
        {error && <p role="alert" className="error mt-3">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              const r = await savePermissionTemplate({
                id: template?.id,
                name,
                description,
                items: toItems(definitions, state).filter((i) => i.scope !== "none"),
              });
              setBusy(false);
              if (!r.ok) return setError(r.error || "Could not save template");
              onSaved();
            }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Save template
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Templates({
  definitions,
  delegable,
  templates,
  people,
  names,
  onSaved,
}: {
  definitions: PermissionDefinition[];
  delegable: PermissionState | null;
  templates: Template[];
  people: Person[];
  names: Record<string, string>;
  onSaved: (text: string) => void;
}) {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [applying, setApplying] = useState<Template | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = Object.fromEntries(definitions.map((d) => [keyOf(d), d.module_label]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Applying a template gives each selected person exactly the template’s access. Permissions outside the template are removed.
          {delegable ? " Permissions you do not hold are left unchanged." : ""}
        </p>
        <Button onClick={() => setEditing("new")}>
          <FileStack size={14} /> New template
        </Button>
      </div>
      {!templates.length ? (
        <div className="panel px-6 py-12 text-center text-sm text-muted-foreground">No templates yet. Save one from an employee’s checklist or create one here.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((t) => {
            const mods = [...new Set(t.items.filter((i) => i.scope !== "none").map((i) => label[keyOf(i)]).filter(Boolean))];
            return (
              <article key={t.id} className="panel p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">{t.name}</h3>
                    {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                  </div>
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{t.items.filter((i) => i.scope !== "none").length} permissions</span>
                </div>
                <p className="mt-3 line-clamp-2 text-[11px] text-muted-foreground">{mods.join(" · ") || "No access"}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  By {names[t.created_by] || "Unknown"} · updated {when(t.updated_at)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" onClick={() => { setApplying(t); setPicked([]); setError(""); }}>
                    <Copy size={13} /> Apply to people
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Delete the template “${t.name}”? People who received it keep their access.`)) return;
                      const r = await deletePermissionTemplate(t.id);
                      if (!r.ok) return setError(r.error || "Could not delete");
                      onSaved("Template deleted");
                    }}
                  >
                    <Trash2 size={13} /> Delete
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {error && !applying && <p role="alert" className="error">{error}</p>}
      {editing && (
        <TemplateDialog
          definitions={definitions}
          initialItems={[]}
          template={editing === "new" ? { id: "", name: "", description: "", items: [], created_by: "", updated_at: "" } : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved("Template saved");
          }}
        />
      )}
      {applying && (
        <Dialog open onOpenChange={(o) => !o && setApplying(null)}>
          <DialogContent title={`Apply “${applying.name}”`} description="Each selected person will get exactly this template’s access.">
            <label className="relative mt-4 block">
              <span className="sr-only">Search people</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" className="h-10 pl-9" />
            </label>
            <ul className="scroll-thin mt-3 max-h-72 space-y-1 overflow-y-auto">
              {people
                .filter((p) => !search || p.full_name.toLowerCase().includes(search.toLowerCase()) || (p.employee_id || "").toLowerCase().includes(search.toLowerCase()))
                .map((p) => (
                  <li key={p.id}>
                    <label className="mb-0 flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-normal hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={picked.includes(p.id)}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))}
                      />
                      <span className="flex-1">{p.full_name}</span>
                      <span className="text-muted-foreground">{[p.employee_id, roleLabel(p.role)].filter(Boolean).join(" · ")}</span>
                    </label>
                  </li>
                ))}
            </ul>
            <div className="mt-3">
              <label htmlFor="apply-reason">Reason</label>
              <input id="apply-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
            {error && <p role="alert" className="error mt-3">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <span className="mr-auto text-xs text-muted-foreground">{picked.length} selected</span>
              <Button variant="outline" onClick={() => setApplying(null)}>
                <X size={14} /> Cancel
              </Button>
              <Button
                disabled={busy || !picked.length}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  const r = await applyPermissionTemplate({ template: applying.id, users: picked, reason });
                  setBusy(false);
                  if (!r.ok) return setError(r.error || "Could not apply template");
                  setApplying(null);
                  onSaved(`Template applied to ${picked.length} ${picked.length === 1 ? "person" : "people"}`);
                }}
              >
                {busy && <Loader2 size={14} className="animate-spin" />} Apply template
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
