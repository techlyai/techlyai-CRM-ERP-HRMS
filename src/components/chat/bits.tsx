"use client";
import { useMemo, useState } from "react";
import { Users, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { initials, type DirectoryPerson } from "./helpers";

export function PersonAvatar({
  name,
  online,
  size = "md",
  className,
}: {
  name: string;
  online?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims =
    size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-[11px]";
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span className={cn("avatar", dims)}>{initials(name) || "?"}</span>
      {online !== undefined && (
        <span
          aria-label={online ? "Online" : "Offline"}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
            online ? "bg-success" : "bg-muted-foreground/40",
          )}
        />
      )}
    </span>
  );
}
export function GroupAvatar({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <span className={cn("icon-tile shrink-0 rounded-full", dims, className)}>
      <Users size={size === "sm" ? 13 : size === "lg" ? 18 : 15} />
    </span>
  );
}
export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
export function roleLabel(role: string) {
  return role === "super_admin" ? "Admin" : role === "manager" ? "Manager" : "Employee";
}
/** Searchable multi-select of colleagues. */
export function PeoplePicker({
  people,
  selected,
  onChange,
  exclude = [],
  emptyText = "No one matches.",
}: {
  people: DirectoryPerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const skip = new Set(exclude);
    const term = q.trim().toLowerCase();
    return people.filter(
      (p) =>
        !skip.has(p.id) &&
        (!term ||
          p.full_name.toLowerCase().includes(term) ||
          (p.department || "").toLowerCase().includes(term)),
    );
  }, [people, exclude, q]);
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );
  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search size={14} className="shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="border-0 bg-transparent px-0 py-2.5 text-[13px] shadow-none focus:shadow-none"
        />
        {selected.length > 0 && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {selected.length} selected
          </span>
        )}
      </div>
      <ul className="max-h-56 overflow-y-auto p-1">
        {list.map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted",
                  on && "bg-primary/5",
                )}
              >
                <PersonAvatar name={p.full_name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.full_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[p.department, roleLabel(p.role)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-md border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Check size={12} />}
                </span>
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</li>
        )}
      </ul>
    </div>
  );
}
