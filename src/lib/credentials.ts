/** Shared, browser-safe types and helpers for client credentials. Never holds secrets. */
export const credentialCategories = [
  "Website Admin",
  "WordPress",
  "Hosting",
  "Domain Registrar",
  "Business Email",
  "Analytics",
  "Social Media",
  "CRM",
  "Payment Gateway",
  "Cloud",
  "Other",
] as const;
export type CredentialCategory = (typeof credentialCategories)[number];

/** A credential row as visible to authorized users. Contains no password material. */
export type Credential = {
  id: string;
  client_id: string;
  service_name: string;
  category: CredentialCategory;
  login_url: string | null;
  username: string | null;
  account_id: string | null;
  project_id: string | null;
  purpose: string;
  notes: string;
  current_version: number;
  password_changed_at: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  archived_at: string | null;
  archived_by: string | null;
  row_version: number;
};
export type CredentialSort = "service" | "updated" | "password";

/** Credentials updated in the last week are highlighted. */
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
export function isRecent(c: Pick<Credential, "updated_at">, now = Date.now()) {
  return now - new Date(c.updated_at).getTime() < RECENT_MS;
}

export function filterCredentials(
  list: Credential[],
  opts: {
    query?: string;
    category?: string;
    project?: string;
    archived?: boolean;
    sort?: CredentialSort;
  },
) {
  const q = (opts.query || "").trim().toLowerCase();
  return list
    .filter((c) => Boolean(c.archived_at) === Boolean(opts.archived))
    .filter((c) => !opts.category || c.category === opts.category)
    .filter((c) => !opts.project || c.project_id === opts.project)
    .filter(
      (c) =>
        !q ||
        [c.service_name, c.username, c.account_id, c.login_url, c.category]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
    )
    .sort((a, b) => {
      if (opts.sort === "updated")
        return b.updated_at.localeCompare(a.updated_at);
      if (opts.sort === "password")
        return b.password_changed_at.localeCompare(a.password_changed_at);
      return a.service_name.localeCompare(b.service_name, "en", {
        sensitivity: "base",
      });
    });
}

/** Finds the password version that was current at a given moment. */
export function versionAt<
  T extends { version: number; created_at: string; replaced_at: string | null },
>(versions: T[], at: Date) {
  const t = at.getTime();
  return (
    versions.find(
      (v) =>
        new Date(v.created_at).getTime() <= t &&
        (!v.replaced_at || new Date(v.replaced_at).getTime() > t),
    ) || null
  );
}

/** Returns a safe http(s) URL to open, or null. */
export function safeUrl(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}
