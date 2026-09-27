import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "../lib/logger.js";
import { db, pool } from "./index.js";

/**
 * Standalone migration runner for deploys: `npm run db:migrate:dist` executes the
 * compiled `dist/db/migrate.js`, so production containers (which omit dev
 * dependencies) can migrate without the app server auto-running DDL on boot.
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  await migrate(db, { migrationsFolder });
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runMigrations()
    .then(async () => {
      logger.info("Migrations applied.");
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, "Migration failed");
      await pool.end();
      process.exit(1);
    });
}
