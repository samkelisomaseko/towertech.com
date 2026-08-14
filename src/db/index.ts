import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const { Pool } = pg;

// Singleton pool shared across the process.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;

export async function pingDatabase(): Promise<boolean> {
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

export { pool };
