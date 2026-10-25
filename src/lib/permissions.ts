/** Browser-safe permission helpers shared by the checklist UI and tests. */
import type { Scope } from "./roles";

export type PermissionDefinition = {
  module: string;
  action: string;
  module_label: string;
  module_group: string;
  label: string;
  description: string;
  scoped: boolean;
  sensitive: boolean;
  sort: number;
};
export type PermissionState = Record<string, Scope>;
export const keyOf = (d: { module: string; action: string }) => `${d.module}.${d.action}`;

/** Default scope when a box is ticked: the narrowest useful reach the editor may grant. */
export function defaultScope(d: PermissionDefinition, max: Scope | undefined): Scope {
  if (!d.scoped) return "all";
  if (!max || max === "all" || max === "team" || max === "department" || max === "self") return "self";
  return "none";
}

/** Differences between two states, for confirmation summaries. */
export function diffPermissions(
  definitions: PermissionDefinition[],
  before: PermissionState,
  after: PermissionState,
) {
  const out: { def: PermissionDefinition; before: Scope; after: Scope; kind: "granted" | "revoked" | "changed" }[] = [];
  for (const d of definitions) {
    const k = keyOf(d);
    const b = before[k] || "none";
    const a = after[k] || "none";
    if (a === b) continue;
    out.push({ def: d, before: b, after: a, kind: b === "none" ? "granted" : a === "none" ? "revoked" : "changed" });
  }
  return out;
}
