"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Search } from "lucide-react";
import { scopeCovers, scopeLabels, scopes, type Scope } from "@/lib/roles";

export {
  keyOf,
  defaultScope,
  diffPermissions,
  type PermissionDefinition,
  type PermissionState,
} from "@/lib/permissions";
import {
  keyOf,
  defaultScope,
  type PermissionDefinition,
  type PermissionState,
} from "@/lib/permissions";

/**
 * Grouped, searchable permission checklist.
 * - `max`: the editor's delegable reach per permission; null means unrestricted (Super Admin).
 * - `inherited`: role defaults, used to label each value as inherited or an override.
 */
export function PermissionChecklist({
  definitions,
  value,
  onChange,
  max,
  inherited,
  initial,
}: {
  definitions: PermissionDefinition[];
  value: PermissionState;
  onChange: (next: PermissionState) => void;
  max: PermissionState | null;
  inherited?: PermissionState;
  initial?: PermissionState;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const modules = useMemo(() => {
    const map = new Map<string, { label: string; group: string; sort: number; defs: PermissionDefinition[] }>();
    for (const d of definitions) {
      const m = map.get(d.module) || { label: d.module_label, group: d.module_group, sort: d.sort, defs: [] };
      m.defs.push(d);
      m.sort = Math.min(m.sort, d.sort);
      map.set(d.module, m);
    }
    return [...map.entries()].sort((a, b) => a[1].sort - b[1].sort);
  }, [definitions]);
  const groups = useMemo(() => {
    const g = new Map<string, typeof modules>();
    for (const entry of modules) {
      const visible = entry[1].defs.filter(
        (d) => !q || d.label.toLowerCase().includes(q) || entry[1].label.toLowerCase().includes(q),
      );
      if (!visible.length) continue;
      g.set(entry[1].group, [...(g.get(entry[1].group) || []), [entry[0], { ...entry[1], defs: visible }]]);
    }
    return [...g.entries()];
  }, [modules, q]);

  const editable = (d: PermissionDefinition) => {
    if (!max) return true;
    const mine = max[keyOf(d)] || "none";
    return mine !== "none" && scopeCovers(mine, value[keyOf(d)] || "none");
  };
  const options = (d: PermissionDefinition): Scope[] => {
    const mine = max ? max[keyOf(d)] || "none" : "all";
    const current = value[keyOf(d)] || "none";
    // Always show the current value, even when it is beyond what this editor may grant.
    return scopes.filter((s) => s !== "none" && (scopeCovers(mine, s) || s === current));
  };
  const set = (patch: PermissionState) => onChange({ ...value, ...patch });
  const granted = Object.values(value).filter((s) => s !== "none").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[200px] flex-1">
          <span className="sr-only">Search permissions</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search permissions…"
            className="h-10 pl-9"
          />
        </label>
        <span className="text-xs text-muted-foreground">
          {granted} of {definitions.length} permissions granted
        </span>
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => setOpen(Object.fromEntries(modules.map(([m]) => [m, true])))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setOpen({})}
        >
          Collapse all
        </button>
      </div>
      {!groups.length && <p className="py-8 text-center text-sm text-muted-foreground">No permissions match “{query}”.</p>}
      <div className="space-y-6">
        {groups.map(([group, mods]) => (
          <section key={group}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{group}</h3>
            <div className="divide-y divide-border rounded-xl border border-border">
              {mods.map(([module, m]) => {
                const keys = m.defs.map(keyOf);
                const on = keys.filter((k) => (value[k] || "none") !== "none").length;
                const editableDefs = m.defs.filter(editable);
                const changed = initial && keys.some((k) => (initial[k] || "none") !== (value[k] || "none"));
                const custom = inherited && keys.some((k) => (inherited[k] || "none") !== (value[k] || "none"));
                const expanded = open[module] || Boolean(q);
                const all = on === keys.length;
                return (
                  <div key={module}>
                    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4">
                      <button
                        type="button"
                        onClick={() => setOpen({ ...open, [module]: !open[module] })}
                        aria-expanded={expanded}
                        aria-label={(expanded ? "Collapse " : "Expand ") + m.label}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <input
                        type="checkbox"
                        aria-label={`Access to ${m.label}`}
                        checked={on > 0}
                        ref={(el) => {
                          if (el) el.indeterminate = on > 0 && !all;
                        }}
                        disabled={!editableDefs.length}
                        onChange={(e) => {
                          const patch: PermissionState = {};
                          for (const d of editableDefs) {
                            const k = keyOf(d);
                            if (!e.target.checked) patch[k] = "none";
                            else if (d.action === "view" && (value[k] || "none") === "none") patch[k] = defaultScope(d, max?.[k]);
                          }
                          set(patch);
                          if (e.target.checked) setOpen({ ...open, [module]: true });
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setOpen({ ...open, [module]: !open[module] })}
                        className="min-w-0 flex-1 text-left text-sm font-medium"
                      >
                        {m.label}
                      </button>
                      {changed && <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">Unsaved</span>}
                      {custom && !changed && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">Custom</span>}
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {on}/{keys.length}
                      </span>
                      <div className="flex gap-2 text-[11px]">
                        <button
                          type="button"
                          disabled={!editableDefs.length}
                          className="font-medium text-primary hover:underline disabled:opacity-40"
                          onClick={() => {
                            const patch: PermissionState = {};
                            for (const d of editableDefs) {
                              const k = keyOf(d);
                              if ((value[k] || "none") === "none") patch[k] = defaultScope(d, max?.[k]);
                            }
                            set(patch);
                          }}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          disabled={!editableDefs.length}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                          onClick={() => set(Object.fromEntries(editableDefs.map((d) => [keyOf(d), "none" as Scope])))}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <ul className="space-y-1 border-t border-border bg-muted/30 px-3 py-2 sm:px-4">
                        {m.defs.map((d) => {
                          const k = keyOf(d);
                          const v = value[k] || "none";
                          const can = editable(d);
                          const inh = inherited?.[k];
                          return (
                            <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-8">
                              <label className={`mb-0 flex min-w-0 flex-1 items-start gap-2.5 text-xs font-normal ${can ? "cursor-pointer" : "opacity-60"}`}>
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={v !== "none"}
                                  disabled={!can}
                                  onChange={(e) => set({ [k]: e.target.checked ? defaultScope(d, max?.[k]) : "none" })}
                                />
                                <span className="min-w-0">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    {d.label}
                                    {d.sensitive && <span className="rounded bg-danger/10 px-1 text-[10px] text-danger">Sensitive</span>}
                                    {!can && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="You can only assign permissions you hold yourself">
                                        <Lock size={10} /> Restricted
                                      </span>
                                    )}
                                  </span>
                                  {d.description && <span className="mt-0.5 block text-[11px] text-muted-foreground">{d.description}</span>}
                                </span>
                              </label>
                              {inherited && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${inh === v ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}
                                  title={inh === v ? "Same as the role default" : `Role default: ${scopeLabels[inh || "none"]}`}
                                >
                                  {inh === v ? "Role default" : "Override"}
                                </span>
                              )}
                              {d.scoped && v !== "none" && (
                                <select
                                  aria-label={`Record scope for ${m.label}: ${d.label}`}
                                  value={v}
                                  disabled={!can}
                                  onChange={(e) => set({ [k]: e.target.value as Scope })}
                                  className="h-8 w-40 py-0 text-xs"
                                >
                                  {options(d).map((s) => (
                                    <option key={s} value={s}>
                                      {scopeLabels[s]}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

