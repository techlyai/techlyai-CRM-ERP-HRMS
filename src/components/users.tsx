"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Search, ShieldCheck } from "lucide-react";
import { type Profile } from "@/lib/modules";
import { createUser, updateProfile } from "@/lib/actions";
import { roleLabel } from "@/lib/roles";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

type Person = Profile & { email?: string | null; employee_id?: string | null; phone?: string };

export function Users({
  people,
  me,
  abilities,
}: {
  people: Person[];
  me: { id: string; role: Profile["role"] };
  /** What the signed-in person may do here; the database re-checks every action. */
  abilities: { create: boolean; edit: boolean; permissions: boolean };
}) {
  const router = useRouter();
  const superAdmin = me.role === "super_admin";
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Person>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; password: string } | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const q = query.trim().toLowerCase();
  const list = people.filter(
    (p) =>
      (!q ||
        p.full_name.toLowerCase().includes(q) ||
        (p.employee_id || "").toLowerCase().includes(q) ||
        (p.phone || "").includes(q)) &&
      (!role || p.role === role),
  );
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Users & access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The right access, for the right people.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {abilities.permissions && (
            <Button variant="outline" asChild>
              <Link href="/settings/roles">
                <KeyRound size={14} /> Roles & permissions
              </Link>
            </Button>
          )}
          {abilities.create && (
            <Button
              onClick={() => {
                setEdit(undefined);
                setCreated(null);
                setError("");
                setOpen(true);
              }}
            >
              <Plus size={14} /> New user
            </Button>
          )}
        </div>
      </div>
      {error && !open && <p className="error mb-5">{error}</p>}
      {created && !open && (
        <div role="status" className="mb-5 rounded-xl border border-success/30 bg-success/5 p-4 text-sm">
          <p className="font-semibold">{created.name} was created with the default permissions for their role.</p>
          <p className="mt-2 text-xs">
            Temporary password: <code className="rounded bg-muted px-1.5 py-0.5 font-bold">{created.password}</code>. Share it securely; it is shown only once.
          </p>
          {abilities.permissions && (
            <Button size="sm" className="mt-3" asChild>
              <Link href={`/settings/roles?user=${created.id}`}>
                <ShieldCheck size={13} /> Review and customize permissions
              </Link>
            </Button>
          )}
        </div>
      )}
      <div className="panel mb-4 flex flex-col gap-3 p-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search users</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, employee ID or phone" className="h-10 pl-9" />
        </label>
        <select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)} className="h-10 sm:w-44">
          <option value="">All roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="manager">Admin</option>
          <option value="employee">Employee</option>
        </select>
      </div>
      <section className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {["Person", "Phone", "Role", "Department", "Reporting manager", "Status", ""].map((t) => (
                <th className="p-4 font-medium" key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-4">
                  <span className="block font-medium">{p.full_name}</span>
                  {p.employee_id && <span className="text-[11px] text-muted-foreground">{p.employee_id}</span>}
                </td>
                <td className="p-4">{p.phone}</td>
                <td className="p-4">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.role === "super_admin" ? "bg-primary/15 text-primary" : p.role === "manager" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"}`}>
                    {roleLabel(p.role)}
                  </span>
                </td>
                <td className="p-4">{p.department || "—"}</td>
                <td className="p-4">{people.find((m) => m.id === p.manager_id)?.full_name || "—"}</td>
                <td className="p-4">{p.active ? "Active" : <span className="text-danger">Inactive</span>}</td>
                <td className="p-4">
                  <div className="flex justify-end gap-2">
                    {abilities.edit && (superAdmin || p.role !== "super_admin") && (
                      <Button size="sm" variant="outline" onClick={() => { setEdit(p); setError(""); setOpen(true); }}>
                        Manage
                      </Button>
                    )}
                    {abilities.permissions && p.role !== "super_admin" && (superAdmin || p.id !== me.id) && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/settings/roles?user=${p.id}`}>
                          <KeyRound size={13} /> Permissions
                        </Link>
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">No users match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={edit ? `Manage ${edit.full_name}` : "Create a user"}
          description={
            edit
              ? "Update profile details and account status. Use Permissions to change what this person can access."
              : "New users start with the default permissions for their role. You can customize them right after creating the account."
          }
        >
          <form
            className="mt-5 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              const input = {
                name: String(f.get("name")),
                department: String(f.get("department") || ""),
                manager: String(f.get("manager") || ""),
                role: String(f.get("role") || edit?.role || "employee"),
                email: String(f.get("email") || ""),
              };
              const r = edit
                ? await updateProfile({ ...input, id: edit.id, active: f.get("active") === "on" })
                : await createUser({ ...input, phone: String(f.get("phone")) });
              setBusy(false);
              if (!r.ok) return setError(r.error || "Failed");
              if (!edit && r.message && r.id) setCreated({ id: r.id, name: input.name, password: r.message });
              setOpen(false);
              router.refresh();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="u-name">Full name *</label>
                <input id="u-name" name="name" defaultValue={edit?.full_name} required maxLength={200} />
              </div>
              {!edit && (
                <div>
                  <label htmlFor="u-phone">Phone number *</label>
                  <input id="u-phone" name="phone" type="tel" required placeholder="+91 98765 43210" />
                </div>
              )}
              <div>
                <label htmlFor="u-email">Email</label>
                <input id="u-email" name="email" type="email" defaultValue={edit?.email || ""} placeholder="name@company.com" />
              </div>
              <div>
                <label htmlFor="u-role">Role</label>
                {superAdmin ? (
                  <select id="u-role" name="role" defaultValue={edit?.role || "employee"}>
                    <option value="employee">Employee</option>
                    <option value="manager">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                ) : (
                  <>
                    <input id="u-role" value={roleLabel(edit?.role || "employee")} readOnly disabled />
                    <p className="mt-1 text-[11px] text-muted-foreground">Only a Super Admin can change roles.</p>
                  </>
                )}
              </div>
              <div>
                <label htmlFor="u-dept">Department</label>
                <input id="u-dept" name="department" defaultValue={edit?.department || ""} />
              </div>
              <div>
                <label htmlFor="u-manager">Reporting manager</label>
                <select id="u-manager" name="manager" defaultValue={edit?.manager_id || ""}>
                  <option value="">No manager</option>
                  {people
                    .filter((p) => p.id !== edit?.id && p.active && p.role !== "employee")
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                </select>
              </div>
            </div>
            {edit && (
              <label className="flex items-center gap-2">
                <input name="active" type="checkbox" defaultChecked={edit.active} disabled={edit.id === me.id && !superAdmin} />
                Account active
              </label>
            )}
            {error && (
              <p role="alert" className="error">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={busy}>{busy ? "Saving…" : edit ? "Save user" : "Create user"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
