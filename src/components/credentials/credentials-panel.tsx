"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  archiveCredential,
  changeCredentialPassword,
  createCredential,
  credentialHistory,
  deleteCredential,
  readCredentialPassword,
  unlockCredentialHistory,
  updateCredential,
  type CredentialVersion,
} from "@/lib/credential-actions";
import {
  credentialCategories,
  filterCredentials,
  isRecent,
  safeUrl,
  versionAt,
  type Credential,
  type CredentialSort,
} from "@/lib/credentials";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { Status } from "../ui/status";

type Person = { id: string; full_name: string };
type Project = { id: string; title: string };
type Toast = { id: number; text: string; tone: "ok" | "error" };

const dateTime = (v: string) =>
  new Date(v).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const date = (v: string) =>
  new Date(v).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
/** How long a revealed password stays visible before it is masked again. */
const REVEAL_MS = 30_000;

async function writeClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) return await navigator.clipboard.writeText(text);
  } catch {
    // Some browsers and embedded views refuse the async clipboard; fall back below.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.value = "";
  area.remove();
  if (!ok) throw Error("Copy was blocked by the browser. Allow clipboard access and try again.");
}

/** Generates a strong random password in the browser for convenience only. */
function generatePassword(length = 20) {
  const sets = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%^&*-_=+?",
  ];
  const all = sets.join("");
  const pick = (s: string) => {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    return s[r[0] % s.length];
  };
  const chars = sets.map(pick);
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function CredentialsPanel({
  client,
  credentials,
  people,
  projects,
  canHistory,
  isAdmin,
}: {
  client: { id: string; title: string; status: string };
  credentials: Credential[];
  people: Person[];
  projects: Project[];
  canHistory: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState<CredentialSort>("service");
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const [changing, setChanging] = useState<Credential | null>(null);
  const [history, setHistory] = useState<Credential | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "archive" | "restore" | "delete";
    credential: Credential;
  } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const readOnly = client.status === "Archived";

  const name = (id: string | null) =>
    people.find((p) => p.id === id)?.full_name || "Unknown";
  const projectName = (id: string | null) =>
    projects.find((p) => p.id === id)?.title;
  const notify = (text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  };

  const active = credentials.filter((c) => !c.archived_at);
  const archivedCount = credentials.length - active.length;
  const visible = useMemo(
    () =>
      filterCredentials(credentials, { query, category, project, sort, archived }),
    [credentials, query, category, project, sort, archived],
  );
  // Group by category when browsing alphabetically; other sorts show one ordered list.
  const groups = useMemo(() => {
    if (sort !== "service" || category) return [["", visible]] as const;
    const map = new Map<string, Credential[]>();
    for (const c of visible) map.set(c.category, [...(map.get(c.category) || []), c]);
    return [...map.entries()].sort(([a], [b]) =>
      a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
    );
  }, [visible, sort, category]);
  const lastChange = active.reduce<string | null>(
    (m, c) => (!m || c.password_changed_at > m ? c.password_changed_at : m),
    null,
  );
  const usedProjects = projects.filter((p) =>
    credentials.some((c) => c.project_id === p.id),
  );

  return (
    <section aria-labelledby="credentials-heading">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck size={14} className="text-primary" />
            Encrypted vault · access is logged
          </div>
          <h2 id="credentials-heading" className="mt-2 text-xl font-semibold">
            Client Credentials
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{client.title}</span>
            <Status value={client.status} />
            <span>
              {active.length} {active.length === 1 ? "credential" : "credentials"}
              {archivedCount ? ` · ${archivedCount} archived` : ""}
            </span>
            {lastChange && <span>· Last password change {date(lastChange)}</span>}
          </div>
        </div>
        {!readOnly && (
          <Button onClick={() => setEditing("new")}>
            <Plus size={15} />
            Add credentials
          </Button>
        )}
      </div>
      {readOnly && (
        <p className="notice mb-4 text-xs">
          This client is archived. Its credentials are kept for reference and
          cannot be changed.
        </p>
      )}

      <div className="panel mb-5 flex flex-col gap-3 p-3 xl:flex-row xl:items-center">
        <label className="relative min-w-0 flex-1 xl:min-w-[240px]">
          <span className="sr-only">Search credentials</span>
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search service, username or account ID…"
            className="h-10 pl-9"
          />
        </label>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-10 sm:w-40"
          >
            <option value="">All categories</option>
            {credentialCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {usedProjects.length > 0 && (
            <select
              aria-label="Filter by project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="h-10 sm:w-40"
            >
              <option value="">All projects</option>
              {usedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Sort credentials"
            value={sort}
            onChange={(e) => setSort(e.target.value as CredentialSort)}
            className="h-10 sm:w-44"
          >
            <option value="service">Service name A–Z</option>
            <option value="updated">Recently updated</option>
            <option value="password">Password changed</option>
          </select>
          <div
            role="group"
            aria-label="Show active or archived"
            className="col-span-2 flex h-10 rounded-lg border border-border p-1 text-xs sm:col-span-1"
          >
            {[false, true].map((a) => (
              <button
                key={String(a)}
                type="button"
                onClick={() => setArchived(a)}
                aria-pressed={archived === a}
                className={`flex-1 rounded-md px-3 transition-colors ${archived === a ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {a ? `Archived${archivedCount ? ` (${archivedCount})` : ""}` : "Active"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel flex flex-col items-center px-6 py-14 text-center">
          <div className="icon-tile mb-4 h-12 w-12 rounded-xl">
            <KeyRound size={22} />
          </div>
          <p className="text-sm font-semibold">
            {credentials.length === 0
              ? "No credentials saved for this client"
              : archived
                ? "No archived credentials"
                : "No credentials match your search"}
          </p>
          <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
            {credentials.length === 0
              ? "Store website, hosting, domain, email and other logins here. Passwords are encrypted and every view is recorded."
              : "Try a different search or clear the filters."}
          </p>
          {credentials.length === 0 && !readOnly && (
            <Button className="mt-5" onClick={() => setEditing("new")}>
              <Plus size={15} />
              Add the first credential
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([group, list]) => (
            <div key={group || "all"}>
              {group && (
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">
                  {group}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tracking-normal">
                    {list.length}
                  </span>
                </h3>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                {list.map((c) => (
                  <CredentialCard
                    key={c.id}
                    credential={c}
                    readOnly={readOnly}
                    isAdmin={isAdmin}
                    updatedBy={name(c.updated_by)}
                    project={projectName(c.project_id)}
                    notify={notify}
                    onEdit={() => setEditing(c)}
                    onChangePassword={() => setChanging(c)}
                    onHistory={() => setHistory(c)}
                    onArchive={() =>
                      setConfirm({
                        kind: c.archived_at ? "restore" : "archive",
                        credential: c,
                      })
                    }
                    onDelete={() => setConfirm({ kind: "delete", credential: c })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <CredentialForm
          client={client.id}
          credential={editing === "new" ? null : editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            notify(msg);
            router.refresh();
          }}
        />
      )}
      {changing && (
        <ChangePasswordDialog
          client={client.id}
          credential={changing}
          onClose={() => setChanging(null)}
          onSaved={() => {
            setChanging(null);
            notify("Password updated · previous version kept in history");
            router.refresh();
          }}
        />
      )}
      {history && (
        <HistoryDialog
          credential={history}
          canHistory={canHistory}
          notify={notify}
          onClose={() => setHistory(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          kind={confirm.kind}
          credential={confirm.credential}
          client={client.id}
          onClose={() => setConfirm(null)}
          onDone={(msg) => {
            setConfirm(null);
            notify(msg);
            router.refresh();
          }}
        />
      )}

      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 lg:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium shadow-lg ${t.tone === "ok" ? "border-success/30 bg-card text-foreground" : "border-danger/30 bg-card text-danger"}`}
          >
            {t.tone === "ok" ? (
              <Check size={14} className="text-success" />
            ) : (
              <X size={14} />
            )}
            {t.text}
          </div>
        ))}
      </div>
    </section>
  );
}

function CopyButton({
  label,
  onCopy,
}: {
  label: string;
  onCopy: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await onCopy();
          setState("done");
          setTimeout(() => setState("idle"), 1600);
        } catch {
          setState("idle");
        }
      }}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {state === "busy" ? (
        <Loader2 size={15} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={15} className="text-success" />
      ) : (
        <Copy size={15} />
      )}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-center gap-2 border-t border-border py-2 first:border-t-0 sm:grid-cols-[104px_1fr]">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
    </div>
  );
}

function CredentialCard({
  credential: c,
  readOnly,
  isAdmin,
  updatedBy,
  project,
  notify,
  onEdit,
  onChangePassword,
  onHistory,
  onArchive,
  onDelete,
}: {
  credential: Credential;
  readOnly: boolean;
  isAdmin: boolean;
  updatedBy: string;
  project?: string;
  notify: (text: string, tone?: Toast["tone"]) => void;
  onEdit: () => void;
  onChangePassword: () => void;
  onHistory: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const menuRef = useRef<HTMLDivElement>(null);
  const url = safeUrl(c.login_url);
  const archived = Boolean(c.archived_at);
  const locked = readOnly || archived;

  useEffect(() => () => clearTimeout(timer.current), []);
  // Mask again when the credential changes (for example after a password update).
  useEffect(() => setRevealed(null), [c.current_version]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node))
        setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const copyText = async (value: string, what: string) => {
    try {
      await writeClipboard(value);
      notify(`${what} copied`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Copy failed", "error");
      throw e;
    }
  };
  async function toggleReveal() {
    if (revealed !== null) {
      setRevealed(null);
      clearTimeout(timer.current);
      return;
    }
    setLoading(true);
    const r = await readCredentialPassword({ id: c.id, purpose: "reveal" });
    setLoading(false);
    if (!r.ok || r.data === undefined) return notify(r.error || "Could not open password", "error");
    setRevealed(r.data);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
  }
  async function copyPassword() {
    // Fetched on demand so the password is never kept in page state just for copying.
    const r = await readCredentialPassword({ id: c.id, purpose: "copy" });
    if (!r.ok || r.data === undefined) {
      notify(r.error || "Could not copy password", "error");
      throw Error("copy failed");
    }
    await copyText(r.data, "Password");
  }

  return (
    <article
      className={`panel relative flex flex-col p-4 sm:p-5 ${archived ? "opacity-75" : ""} ${!archived && isRecent(c) ? "ring-1 ring-primary/25" : ""}`}
    >
      <header className="mb-3 flex items-start gap-3">
        <div className="icon-tile h-10 w-10 shrink-0 rounded-xl">
          <KeyRound size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold">{c.service_name}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
              {c.category}
            </span>
            {project && (
              <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-accent">
                {project}
              </span>
            )}
            {!archived && isRecent(c) && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                Recently updated
              </span>
            )}
            {archived && (
              <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-warning">
                Archived
              </span>
            )}
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label={`More actions for ${c.service_name}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div
              role="menu"
              className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-border bg-card p-1 text-xs shadow-xl"
            >
              {[
                !locked && { icon: Pencil, label: "Edit details", run: onEdit },
                !locked && { icon: KeyRound, label: "Change password", run: onChangePassword },
                { icon: History, label: "Password history", run: onHistory },
                !readOnly && {
                  icon: archived ? ArchiveRestore : Archive,
                  label: archived ? "Restore" : "Archive",
                  run: onArchive,
                },
                isAdmin && archived && !readOnly && {
                  icon: Trash2,
                  label: "Delete permanently",
                  run: onDelete,
                  danger: true,
                },
              ]
                .filter(Boolean)
                .map((item) => {
                  const it = item as {
                    icon: React.ElementType;
                    label: string;
                    run: () => void;
                    danger?: boolean;
                  };
                  return (
                    <button
                      key={it.label}
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        it.run();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted ${it.danger ? "text-danger" : ""}`}
                    >
                      <it.icon size={14} />
                      {it.label}
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      </header>

      <div className="rounded-lg border border-border bg-background/60 px-3">
        {c.login_url && (
          <Field label="Login URL">
            <span className="min-w-0 flex-1 truncate text-xs" title={c.login_url}>
              {c.login_url}
            </span>
            <CopyButton label="Copy login URL" onCopy={() => copyText(c.login_url!, "Login URL")} />
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open website"
                title="Open website"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ExternalLink size={15} />
              </a>
            )}
          </Field>
        )}
        <Field label="Username">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {c.username || <span className="font-sans text-muted-foreground">Not set</span>}
          </span>
          {c.username && (
            <CopyButton label="Copy username" onCopy={() => copyText(c.username!, "Username")} />
          )}
        </Field>
        {c.account_id && (
          <Field label="Email / ID">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.account_id}</span>
            <CopyButton label="Copy account ID" onCopy={() => copyText(c.account_id!, "Account ID")} />
          </Field>
        )}
        <Field label="Password">
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs"
            aria-label={revealed === null ? "Password hidden" : "Password shown"}
          >
            {revealed === null ? "••••••••••••" : revealed}
          </span>
          <button
            type="button"
            onClick={toggleReveal}
            aria-label={revealed === null ? "Show password" : "Hide password"}
            title={revealed === null ? "Show password" : "Hide password"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : revealed === null ? (
              <Eye size={15} />
            ) : (
              <EyeOff size={15} />
            )}
          </button>
          <CopyButton label="Copy password" onCopy={copyPassword} />
        </Field>
      </div>

      {(c.purpose || c.notes) && (
        <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
          {c.purpose && <p className="line-clamp-2">{c.purpose}</p>}
          {c.notes && <p className="line-clamp-2 whitespace-pre-line">{c.notes}</p>}
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
        <span>
          Password changed {date(c.password_changed_at)} · v{c.current_version}
        </span>
        <span>
          Updated {date(c.updated_at)} by {updatedBy}
        </span>
        <button
          type="button"
          onClick={onHistory}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-muted sm:w-auto sm:px-3"
        >
          <History size={13} />
          Password history
        </button>
      </footer>
    </article>
  );
}

function PasswordInput({
  value,
  onChange,
  label,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  id: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          autoFocus={autoFocus}
          className="pr-20 font-mono"
          required
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
          <button
            type="button"
            title="Generate a strong password"
            aria-label="Generate a strong password"
            onClick={() => {
              onChange(generatePassword());
              setShow(true);
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Wand2 size={15} />
          </button>
          <button
            type="button"
            aria-label={show ? "Hide password" : "Show password"}
            onClick={() => setShow(!show)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialForm({
  client,
  credential,
  projects,
  onClose,
  onSaved,
}: {
  client: string;
  credential: Credential | null;
  projects: Project[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const c = credential;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={c ? `Edit ${c.service_name}` : "Add credentials"}
        description={
          c
            ? "Update service details. To change the password, use Change password so the previous version is kept."
            : "Passwords are encrypted before they are stored. Only people who can edit this client can view them."
        }
      >
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            const details = Object.fromEntries(
              ["service_name", "category", "login_url", "username", "account_id", "project_id", "purpose", "notes"].map(
                (k) => [k, String(f.get(k) || "")],
              ),
            );
            const r = c
              ? await updateCredential({ id: c.id, client, rowVersion: c.row_version, details })
              : await createCredential({ client, details, password });
            setBusy(false);
            if (!r.ok) setError(r.error || "Save failed");
            else onSaved(c ? "Credential details updated" : "Credentials saved");
          }}
        >
          <div className="sm:col-span-2">
            <label htmlFor="cred-service">Service or platform *</label>
            <input
              id="cred-service"
              name="service_name"
              required
              maxLength={120}
              defaultValue={c?.service_name}
              placeholder="Website Admin Panel"
              list="cred-service-suggestions"
              autoFocus
            />
            <datalist id="cred-service-suggestions">
              {["Website Admin Panel", "WordPress", "cPanel", "Hosting Provider", "Domain Registrar", "Business Email", "Google Analytics", "Google Search Console", "Facebook", "Instagram", "LinkedIn", "CRM"].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="cred-category">Category</label>
            <select id="cred-category" name="category" defaultValue={c?.category || "Website Admin"}>
              {credentialCategories.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cred-project">Related project</label>
            <select id="cred-project" name="project_id" defaultValue={c?.project_id || ""}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cred-url">Login URL</label>
            <input id="cred-url" name="login_url" type="url" inputMode="url" defaultValue={c?.login_url || ""} placeholder="https://example.com/admin" />
          </div>
          <div>
            <label htmlFor="cred-username">Username</label>
            <input id="cred-username" name="username" defaultValue={c?.username || ""} autoComplete="off" spellCheck={false} placeholder="admin" />
          </div>
          <div>
            <label htmlFor="cred-account">Email or account ID</label>
            <input id="cred-account" name="account_id" defaultValue={c?.account_id || ""} autoComplete="off" spellCheck={false} placeholder="owner@client.com" />
          </div>
          {!c && (
            <div className="sm:col-span-2">
              <PasswordInput id="cred-password" label="Password *" value={password} onChange={setPassword} />
            </div>
          )}
          <div className="sm:col-span-2">
            <label htmlFor="cred-purpose">Purpose or description</label>
            <input id="cred-purpose" name="purpose" maxLength={2000} defaultValue={c?.purpose} placeholder="Used to update products and offers" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="cred-notes">Notes</label>
            <textarea id="cred-notes" name="notes" maxLength={5000} defaultValue={c?.notes} placeholder="Two-factor codes go to the client's phone." />
            <p className="mt-1 text-[11px] text-muted-foreground">Do not put passwords in notes. Notes are not encrypted.</p>
          </div>
          {error && (
            <p role="alert" className="error sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {c ? "Save details" : "Save credentials"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({
  client,
  credential: c,
  onClose,
  onSaved,
}: {
  client: string;
  credential: Credential;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Change password · ${c.service_name}`}
        description={`Version ${c.current_version} will move to history and stay available to authorized reviewers. The new password becomes version ${c.current_version + 1}.`}
      >
        <form
          className="mt-5 space-y-4"
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            if (password !== confirm) return setError("The two passwords do not match");
            setBusy(true);
            setError("");
            const r = await changeCredentialPassword({
              id: c.id,
              client,
              rowVersion: c.row_version,
              currentVersion: c.current_version,
              password,
              reason,
            });
            setBusy(false);
            if (!r.ok) setError(r.error || "Update failed");
            else onSaved();
          }}
        >
          <PasswordInput id="new-password" label="New password *" value={password} onChange={setPassword} autoFocus />
          <div>
            <label htmlFor="confirm-password">Confirm new password *</label>
            <input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="font-mono"
              required
            />
            {confirm && password !== confirm && (
              <p className="mt-1 text-[11px] text-danger">Passwords do not match yet.</p>
            )}
          </div>
          <div>
            <label htmlFor="change-reason">Reason for change</label>
            <input
              id="change-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="Quarterly rotation, staff change, client request…"
            />
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !password || password !== confirm}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              Save new password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  credential: c,
  canHistory,
  notify,
  onClose,
}: {
  credential: Credential;
  canHistory: boolean;
  notify: (text: string, tone?: Toast["tone"]) => void;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<CredentialVersion[] | null>(null);
  const [unlockedUntil, setUnlockedUntil] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [when, setWhen] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let live = true;
    credentialHistory(c.id).then((r) => {
      if (!live) return;
      if (!r.ok || !r.data) setError(r.error || "Could not load history");
      else {
        setVersions(r.data.versions);
        setUnlockedUntil(r.data.unlockedUntil);
      }
    });
    const pending = timers.current;
    return () => {
      live = false;
      pending.forEach(clearTimeout);
    };
  }, [c.id]);

  const unlocked = Boolean(unlockedUntil && new Date(unlockedUntil) > new Date());
  const allowed = (v: CredentialVersion) => v.is_current || (canHistory && unlocked);
  const match = when && versions ? versionAt(versions, new Date(when)) : null;

  async function reveal(v: CredentialVersion) {
    if (revealed[v.version] !== undefined) {
      setRevealed(({ [v.version]: _hidden, ...rest }) => rest);
      return;
    }
    setBusyVersion(v.version);
    const r = await readCredentialPassword({ id: c.id, version: v.version, purpose: "reveal" });
    setBusyVersion(null);
    if (!r.ok || r.data === undefined) return notify(r.error || "Could not open password", "error");
    setRevealed((s) => ({ ...s, [v.version]: r.data! }));
    timers.current.push(
      setTimeout(
        () => setRevealed(({ [v.version]: _expired, ...rest }) => rest),
        REVEAL_MS,
      ),
    );
  }
  async function copy(v: CredentialVersion) {
    const r = await readCredentialPassword({ id: c.id, version: v.version, purpose: "copy" });
    if (!r.ok || r.data === undefined) {
      notify(r.error || "Could not copy password", "error");
      throw Error("copy failed");
    }
    await writeClipboard(r.data);
    notify(`Version ${v.version} password copied`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Password history · ${c.service_name}`}
        description="Every password change is kept as a separate encrypted version. Opening or copying any version is recorded in the audit log."
      >
        <div className="mt-5 space-y-5">
          {error && <p className="error">{error}</p>}
          {!versions && !error && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={14} className="animate-spin" />
              Loading versions…
            </p>
          )}

          {versions && canHistory && !unlocked && versions.length > 1 && (
            <form
              className="notice flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                setUnlocking(true);
                const r = await unlockCredentialHistory({ password: unlockPassword });
                setUnlocking(false);
                setUnlockPassword("");
                if (!r.ok || !r.data) notify(r.error || "Could not confirm", "error");
                else {
                  setUnlockedUntil(r.data);
                  notify("Previous passwords unlocked for 10 minutes");
                }
              }}
            >
              <div className="flex-1">
                <label htmlFor="unlock-password" className="flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-primary" />
                  Confirm your Orbit password to open previous passwords
                </label>
                <input
                  id="unlock-password"
                  type="password"
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={unlocking || !unlockPassword}>
                {unlocking && <Loader2 size={15} className="animate-spin" />}
                Unlock for 10 minutes
              </Button>
            </form>
          )}
          {versions && !canHistory && versions.length > 1 && (
            <p className="notice text-xs">
              Previous passwords can be opened only by Admins and people with
              Approve access to clients. You can see when each change happened.
            </p>
          )}
          {unlocked && unlockedUntil && (
            <p className="text-[11px] text-muted-foreground">
              Previous passwords unlocked until{" "}
              {new Date(unlockedUntil).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.
            </p>
          )}

          {versions && versions.length > 1 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
              <label htmlFor="history-when" className="mb-0 shrink-0 text-xs">
                Which password was in use on
              </label>
              <input
                id="history-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="h-9 sm:w-56"
              />
              {when && (
                <span className="text-xs">
                  {match ? (
                    <>
                      <strong>Version {match.version}</strong>
                      {match.is_current ? " (current)" : ""}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Before this credential was saved</span>
                  )}
                </span>
              )}
            </div>
          )}

          {versions && (
            <ol className="space-y-3">
              {versions.map((v) => {
                const open = revealed[v.version];
                return (
                  <li
                    key={v.version}
                    className={`rounded-xl border p-3 sm:p-4 ${v.is_current ? "border-primary/40 bg-primary/[.04]" : "border-border"} ${match?.version === v.version ? "ring-2 ring-accent/40" : ""}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">Version {v.version}</span>
                        {v.is_current && (
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            Current
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        Set {dateTime(v.created_at)} by {v.created_by}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center gap-1 rounded-lg border border-border bg-background/60 px-3 py-1">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {open !== undefined ? open : "••••••••••••"}
                      </span>
                      {allowed(v) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => reveal(v)}
                            aria-label={open !== undefined ? `Hide version ${v.version}` : `Show version ${v.version}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {busyVersion === v.version ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : open !== undefined ? (
                              <EyeOff size={15} />
                            ) : (
                              <Eye size={15} />
                            )}
                          </button>
                          <CopyButton label={`Copy version ${v.version} password`} onCopy={() => copy(v)} />
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Locked</span>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {v.replaced_at
                        ? `Replaced ${dateTime(v.replaced_at)}${v.replaced_by ? ` by ${v.replaced_by}` : ""}`
                        : "In use now"}
                      {v.reason ? ` · ${v.reason}` : ""}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              <RotateCcw size={14} />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  kind,
  credential: c,
  client,
  onClose,
  onDone,
}: {
  kind: "archive" | "restore" | "delete";
  credential: Credential;
  client: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = {
    archive: {
      title: `Archive ${c.service_name}?`,
      body: "The credential and its password history are kept but hidden from the active list. You can restore it later.",
      button: "Archive credential",
    },
    restore: {
      title: `Restore ${c.service_name}?`,
      body: "The credential returns to the active list with its full password history.",
      button: "Restore credential",
    },
    delete: {
      title: `Permanently delete ${c.service_name}?`,
      body: "This removes the credential and every stored password version. The audit log keeps a record of the deletion. This cannot be undone.",
      button: "Delete permanently",
    },
  }[kind];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={copy.title} description={copy.body}>
        <form
          className="mt-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const r =
              kind === "delete"
                ? await deleteCredential({ id: c.id, client, reason })
                : await archiveCredential({ id: c.id, client, archived: kind === "archive" });
            setBusy(false);
            if (!r.ok) setError(r.error || "Action failed");
            else
              onDone(
                kind === "delete"
                  ? "Credential deleted"
                  : kind === "archive"
                    ? "Credential archived"
                    : "Credential restored",
              );
          }}
        >
          {kind === "delete" && (
            <>
              <div>
                <label htmlFor="delete-reason">Reason for deletion *</label>
                <input id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required />
              </div>
              <div>
                <label htmlFor="delete-confirm">
                  Type <span className="font-mono">{c.service_name}</span> to confirm
                </label>
                <input id="delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" required />
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={kind === "delete" ? "destructive" : "default"}
              disabled={busy || (kind === "delete" && (typed !== c.service_name || reason.trim().length < 5))}
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {copy.button}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
