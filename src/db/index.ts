import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const { Pool } = pg;

// Primary pool + optional Supabase fallback (used when primary is unreachable,
// e.g. no local Postgres on this box). Active pool is chosen lazily per query.
const primaryPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const fallbackPool = env.SUPABASE_DATABASE_URL
  ? new Pool({
      connectionString: env.SUPABASE_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false }
    })
  : null;

let activePool: pg.Pool | null = null;

async function canConnect(pool: pg.Pool): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return true;
  } catch {
    return false;
  }
}

async function getPool(): Promise<pg.Pool> {
  if (activePool) return activePool;
  if (await canConnect(primaryPool)) {
    activePool = primaryPool;
  } else if (fallbackPool && (await canConnect(fallbackPool))) {
    // eslint-disable-next-line no-console
    console.log("ℹ️  Primary DATABASE_URL unreachable — using SUPABASE_DATABASE_URL fallback.");
    activePool = fallbackPool;
  } else {
    activePool = primaryPool;
  }
  return activePool;
}

// Singleton pool shared across the process (primary; kept for direct access).
const pool = primaryPool;

// Routing facade: drizzle talks to this, it delegates to whichever pool is alive.
// Cast needed because we only implement the subset drizzle-orm/node-postgres uses.
const routingPool = {
  query: async (...args: [string, unknown[]?]) => (await getPool()).query(...args),
  connect: async () => (await getPool()).connect(),
  on: (event: string, listener: (...args: never[]) => void) => {
    primaryPool.on(event as "error", listener as (err: Error, client: pg.PoolClient) => void);
    fallbackPool?.on(event as "error", listener as (err: Error, client: pg.PoolClient) => void);
  },
  end: async () => {
    await primaryPool.end().catch(() => undefined);
    await fallbackPool?.end().catch(() => undefined);
  }
};

export const db = drizzle(routingPool as unknown as pg.Pool, { schema });
export type DB = typeof db;

export async function pingDatabase(): Promise<boolean> {
  try {
    await getPool();
    const client = await (await getPool()).connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return true;
  } catch {
    return false;
  }
}

export { pool };
