"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import { type Profile, modules, actions } from "@/lib/modules";
import { createUser, updateProfile, setPermission } from "@/lib/actions";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
export function Users({
  people,
  permissions,
}: {
  people: Profile[];
  permissions: {
    id: string;
    user_id: string | null;
    role: string | null;
    module: string;
    action: string;
    scope: string;
  }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Profile>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [scopeTarget, setScopeTarget] = useState("manager");
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Users & access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The right access, for the right people.
          </p>
        </div>
        <Button
          onClick={() => {
            setEdit(undefined);
            setPassword("");
            setError("");
            setOpen(true);
          }}
        >
          <Plus size={14} />
          New user
        </Button>
      </div>
      {error && !open && <p className="error mb-5">{error}</p>}
      {password && !open && (
        <p role="status" className="mb-5 rounded-lg border p-4 text-sm">
          User created. Temporary password:{" "}
          <code className="font-bold">{password}</code>
          <br />
          Share this securely with the employee. It is shown only in this
          session.
        </p>
      )}
      <section className="panel overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {[
                "Employee",
                "Phone",
                "Role",
                "Department",
                "Reporting manager",
                "Status",
                "",
              ].map((t) => (
                <th className="p-4" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-4 font-medium">{p.full_name}</td>
                <td className="p-4">{p.phone}</td>
                <td className="p-4 capitalize">{p.role.replace("_", " ")}</td>
                <td className="p-4">{p.department || "—"}</td>
                <td className="p-4">
                  {people.find((m) => m.id === p.manager_id)?.full_name || "—"}
                </td>
                <td className="p-4">{p.active ? "Active" : "Inactive"}</td>
                <td className="p-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEdit(p);
                      setError("");
                      setOpen(true);
                    }}
                  >
                    Manage
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel mt-6 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          <h2 className="section-title">Granular permissions</h2>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          User overrides take priority over role defaults. Team access follows
          each employee’s reporting manager. Managers start with no module
          permissions until granted.
        </p>
        <form
          className="mt-5 grid items-end gap-3 md:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            const target = String(f.get("target"));
            const r = await setPermission({
              role: ["manager", "employee"].includes(target)
                ? target
                : undefined,
              user: ["manager", "employee"].includes(target)
                ? undefined
                : target,
              module: String(f.get("module")),
              action: String(f.get("action")),
              scope: String(f.get("scope")),
            });
            if (!r.ok) setError(r.error || "Failed");
            else router.refresh();
            setBusy(false);
          }}
        >
          <div>
            <label>User / role</label>
            <select
              name="target"
              value={scopeTarget}
              onChange={(e) => setScopeTarget(e.target.value)}
            >
              <option value="manager">Manager role</option>
              <option value="employee">Employee role</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Module</label>
            <select name="module">
              {modules.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Action</label>
            <select name="action">
              {actions.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Scope</label>
            <select name="scope">
              <option value="none">No access</option>
              <option value="self">Own records</option>
              <option value="team">Reporting team</option>
              <option value="all">All records</option>
            </select>
          </div>
          <Button disabled={busy}>Save permission</Button>
        </form>
        <div className="mt-6 max-h-96 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="py-3">Module</th>
                <th>Action</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {permissions
                .filter(
                  (p) => p.role === scopeTarget || p.user_id === scopeTarget,
                )
                .map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="py-2">
                      {modules.find((m) => m.key === p.module)?.title}
                    </td>
                    <td className="capitalize">{p.action}</td>
                    <td>{p.scope}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={edit ? "Manage employee access" : "Create a user"}
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
                department: String(f.get("department")),
                manager: String(f.get("manager") || ""),
                role: String(f.get("role")),
              };
              const r = edit
                ? await updateProfile({
                    ...input,
                    id: edit.id,
                    active: f.get("active") === "on",
                  })
                : await createUser({ ...input, phone: String(f.get("phone")) });
              if (!r.ok) setError(r.error || "Failed");
              else {
                if (r.message) setPassword(r.message);
                setOpen(false);
                router.refresh();
              }
              setBusy(false);
            }}
          >
            <div>
              <label>Full name *</label>
              <input name="name" defaultValue={edit?.full_name} required />
            </div>
            {!edit && (
              <div>
                <label>Phone number *</label>
                <input
                  name="phone"
                  type="tel"
                  required
                  placeholder="+91 98765 43210"
                />
              </div>
            )}
            <div>
              <label>Role</label>
              <select name="role" defaultValue={edit?.role || "employee"}>
                <option value="employee">Employee</option>
                <option value="manager">Department manager</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div>
              <label>Department</label>
              <input name="department" defaultValue={edit?.department || ""} />
            </div>
            <div>
              <label>Reporting manager</label>
              <select name="manager" defaultValue={edit?.manager_id || ""}>
                <option value="">Select manager</option>
                {people
                  .filter(
                    (p) =>
                      p.id !== edit?.id && p.active && p.role !== "employee",
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
              </select>
            </div>
            {edit && (
              <label className="flex items-center gap-2">
                <input
                  name="active"
                  type="checkbox"
                  defaultChecked={edit.active}
                />
                Account active
              </label>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Button disabled={busy}>
              {busy ? "Saving…" : edit ? "Save user" : "Create user"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
