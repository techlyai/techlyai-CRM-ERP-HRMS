import { readFileSync } from "node:fs";
import { Pool } from "pg";
async function main() {
  if (!process.env.DATABASE_ADMIN_URL)
    throw Error("Set DATABASE_ADMIN_URL for transactional integration tests.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_ADMIN_URL,
    connectionTimeoutMillis: 8000,
  });
  const c = await pool.connect();
  try {
    await c.query(readFileSync("tests/database.sql", "utf8"));
    console.log(
      "PostgreSQL RLS and business workflow integration tests passed; fixtures rolled back.",
    );
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
