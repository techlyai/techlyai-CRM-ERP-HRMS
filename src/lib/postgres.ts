import { Pool, types, type PoolClient } from "pg";

// Keep JSON and table values consistent with the application's existing contracts.
types.setTypeParser(1700, Number);
types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw Error("Database integer exceeds supported range");
  return n;
});
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1184, (value) => new Date(value).toISOString());
const globalPool = globalThis as typeof globalThis & { techlyPool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw Error("PostgreSQL is not configured. Follow docs/SETUP.md.");
  if (!globalPool.techlyPool) {
    globalPool.techlyPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      application_name: "techly",
    });
    globalPool.techlyPool.on("error", () =>
      console.error("PostgreSQL idle connection failed"),
    );
  }
  return globalPool.techlyPool;
}
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("set local role techly_service");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
