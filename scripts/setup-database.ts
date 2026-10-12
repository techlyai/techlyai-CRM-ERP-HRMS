import { Pool } from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
const files = [
  "bootstrap.sql",
  "schema.sql",
  "contracts.sql",
  "scheduler.sql",
  "analytics.sql",
  "admin.sql",
  "storage.sql",
];
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url)
    throw Error(
      "Set DATABASE_ADMIN_URL in .env.database to a dedicated, empty PostgreSQL database.",
    );
  const source = files.map((name) => readFileSync("database/" + name, "utf8"));
  const checksum = createHash("sha256").update(source.join("\n")).digest("hex");
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 8000,
  });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select pg_advisory_xact_lock(hashtext('techly-schema-install'))",
    );
    const version = Number(
      (await c.query("show server_version_num")).rows[0].server_version_num,
    );
    if (version < 150000) throw Error("PostgreSQL 15 or later is required.");
    const installed = (
      await c.query(
        "select to_regclass('private.schema_migrations') as existing",
      )
    ).rows[0].existing;
    if (installed) {
      const current = (
        await c.query(
          "select checksum from private.schema_migrations where version=1",
        )
      ).rows[0];
      if (current?.checksum !== checksum)
        throw Error(
          "Schema source differs from the installed migration. Create a new migration; do not overwrite the database.",
        );
      await c.query("commit");
      console.log(
        "Techly schema is already installed. Existing data and credentials preserved.",
      );
      return;
    }
    const existing = await c.query(
      "select tablename from pg_tables where schemaname in ('public','private')",
    );
    if (existing.rows.length)
      throw Error("Database is not empty. Select a new dedicated database.");
    const role = await c.query(
      "select rolname from pg_roles where rolname='techly_app'",
    );
    if (role.rows.length)
      throw Error(
        "techly_app already exists on this cluster. Use a dedicated cluster or review role provisioning before continuing.",
      );
    for (let i = 0; i < files.length; i++) {
      // One outer transaction makes the entire initial schema atomic.
      const sql = source[i]
        .replace(/^begin;\s*$/gim, "")
        .replace(/^commit;\s*$/gim, "");
      try {
        await c.query(sql);
      } catch (error) {
        const dbError = error as Error & { position?: string; where?: string };
        const line = dbError.position
          ? sql.slice(0, Number(dbError.position) - 1).split("\n").length
          : undefined;
        console.error(`Schema error in ${files[i]}${line ? `:${line}` : ""}${dbError.where ? ` (${dbError.where})` : ""}`);
        throw error;
      }
      console.log("Applied " + files[i]);
    }
    const password = randomBytes(32).toString("hex");
    await c.query(
      `create role techly_app login noinherit nosuperuser nocreatedb nocreaterole nobypassrls password ${literal(password)}`,
    );
    await c.query("grant techly_user,techly_service to techly_app");
    const dbname = (await c.query("select current_database() as name")).rows[0]
      .name as string;
    const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    await c.query(`grant connect on database ${quote(dbname)} to techly_app`);
    await c.query(
      "create table private.schema_migrations(version integer primary key,checksum text not null,applied_at timestamptz not null default now())",
    );
    await c.query(
      "insert into private.schema_migrations(version,checksum) values(1,$1)",
      [checksum],
    );
    await c.query(
      "alter table private.schema_migrations enable row level security",
    );
    const app = new URL(url);
    app.username = "techly_app";
    app.password = password;
    const previous = existsSync(".env.local")
      ? readFileSync(".env.local", "utf8")
      : "";
    if (/^DATABASE_URL=.+/m.test(previous))
      throw Error(
        ".env.local already has DATABASE_URL. Preserve it and choose a separate workspace for this database.",
      );
    const defaults = `NEXT_PUBLIC_APP_URL=http://localhost:3000\nNEXT_PUBLIC_APP_TIMEZONE=Asia/Kolkata\nNEXT_PUBLIC_DEFAULT_COUNTRY_CODE=91\nCRON_SECRET=${randomBytes(32).toString("hex")}\n`;
    // Write before COMMIT; a failed commit leaves a connection that cannot authenticate,
    // never an undocumented live credential. On failure the new env file is restored.
    const content =
      (previous.replace(/^DATABASE_URL=.*\r?\n?/gm, "") || defaults) +
      `\nDATABASE_URL=${app.href}\n`;
    writeFileSync(".env.local", content, { mode: 0o600 });
    try {
      await c.query("commit");
    } catch (e) {
      writeFileSync(".env.local", previous, { mode: 0o600 });
      throw e;
    }
    console.log(
      "Schema installed. Restricted runtime connection saved to .env.local.",
    );
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
