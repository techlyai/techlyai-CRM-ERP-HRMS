import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";
import type { Profile } from "./modules";
import { transaction } from "./postgres";
import { sessionProfile, SESSION_SECONDS } from "./auth";
import { identifier, selectQuery } from "./query";
export const configured = () => Boolean(process.env.DATABASE_URL);
export class Database {
  constructor(
    public token: string,
    private service = false,
  ) {}
  async run<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return transaction(async (c) => {
      if (!this.service) {
        const profile = await sessionProfile(c, this.token);
        if (!profile || profile.must_change_password)
          throw Error("Sign in and change your initial password to continue.");
        await c.query("select set_config('app.user_id',$1,true)", [profile.id]);
        await c.query("set local role techly_user");
      }
      return fn(c);
    });
  }
  select<T>(table: string, query = "select=*"): Promise<T[]> {
    const sql = selectQuery(table, query);
    return this.run(async (c) => (await c.query(sql)).rows as T[]);
  }
  rpc<T = unknown>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    identifier(name);
    return this.run(async (c) => {
      const { rows } = await c.query(
        "select p.proretset,p.proargnames,p.pronargs,oidvectortypes(p.proargtypes) as argtypes from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 and p.prokind='f'",
        [name],
      );
      if (rows.length !== 1) throw Error("Unknown or ambiguous operation");
      const fn = rows[0];
      const names: string[] = (fn.proargnames || []).slice(0, fn.pronargs);
      const types = (fn.argtypes as string).split(", ");
      const values: unknown[] = [];
      const named = Object.entries(args)
        .map(([key, value]) => {
          const index = names.indexOf(key);
          if (index < 0) throw Error("Unknown operation parameter");
          const type = types[index];
          values.push(
            type === "jsonb" || type === "json"
              ? value == null
                ? null
                : JSON.stringify(value)
              : value,
          );
          return `${identifier(key)} => $${values.length}::${type}`;
        })
        .join(",");
      const invocation = `public.${identifier(name)}(${named})`;
      const result = await c.query(
        fn.proretset
          ? `select * from ${invocation}`
          : `select ${invocation} as value`,
        values,
      );
      return (fn.proretset ? result.rows : result.rows[0]?.value) as T;
    });
  }
}
export const serviceDB = () => new Database("", true);
export async function context(allowPasswordChange = false) {
  const token = cookies().get("techly-session")?.value;
  if (!token) redirect("/login");
  const profile = await transaction((c) => sessionProfile(c, token));
  if (!profile) redirect("/login");
  if (profile.must_change_password && !allowPasswordChange)
    redirect("/change-password");
  return { db: new Database(token), profile, token };
}
export async function setSession(token: string) {
  const appURL = new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  );
  if (
    process.env.NODE_ENV === "production" &&
    appURL.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(appURL.hostname)
  )
    throw Error("Production login requires HTTPS");
  cookies().set("techly-session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appURL.protocol === "https:",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}
export async function referencesFor(db: Database, module: string) {
  const needed: Record<string, string[]> = {
    eod: ["projects"],
    tasks: ["projects"],
    expenses: ["projects"],
    purchases: ["projects", "inventory"],
    credit: ["purchases"],
    corrections: ["attendance"],
    maintenance: ["assets"],
  };
  const groups = await Promise.all(
    (needed[module] || []).map((m) =>
      db.select<{ id: string; title: string; module: string }>(
        "records",
        `select=id,title,module&module=eq.${m}&status=neq.Archived&order=updated_at.desc&limit=500`,
      ),
    ),
  );
  return groups.flat();
}
export async function grants(db: Database) {
  return db.select<{
    user_id: string | null;
    role: string | null;
    module: string;
    action: string;
    scope: string;
  }>("permission_grants");
}
export function allowed(
  profile: Profile,
  permissions: Awaited<ReturnType<typeof grants>>,
  module: string,
  action: string,
  owner = profile.id,
) {
  if (profile.role === "super_admin") return true;
  if (
    profile.role === "employee" &&
    (module === "onboarding" ||
      (["employees", "payroll", "attendance", "leave", "corrections"].includes(
        module,
      ) &&
        owner !== profile.id))
  )
    return false;
  const grant =
    permissions.find(
      (g) =>
        g.user_id === profile.id && g.module === module && g.action === action,
    ) ||
    permissions.find(
      (g) =>
        g.role === profile.role && g.module === module && g.action === action,
    );
  return Boolean(
    grant &&
      grant.scope !== "none" &&
      (grant.scope !== "self" || owner === profile.id),
  );
}
