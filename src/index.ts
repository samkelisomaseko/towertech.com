import { createServer } from "node:http";
import { createApp, logger } from "./app.js";
import { env } from "./config.js";
import { pingDatabase, pool } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { db } from "./db/index.js";
import { products } from "./db/schema.js";
import { runSeed } from "./db/seed.js";
import { count } from "drizzle-orm";

const app = createApp();

const server = createServer(app);
// Node's defaults (5s) are shorter than common LB idle timeouts; keep the
// socket alive a little longer than a 60s load-balancer cutoff.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
const port = env.PORT;

server.listen(port, async () => {
  const dbUp = await pingDatabase();
  if (!dbUp) {
    logger.error("Database unreachable — refusing to serve without a database. Verify DATABASE_URL and run migrations.");
    process.exit(1);
  }
  logger.info({ port, env: env.NODE_ENV, db: "connected" }, "TowerTech server started");

  try {
    if (env.DB_AUTO_MIGRATE) {
      await runMigrations();
      logger.info("Migrations applied.");
    } else {
      logger.info("DB_AUTO_MIGRATE=false — skipping boot migrations (deploy step owns DDL).");
    }

    if (env.DB_AUTO_SEED) {
      const [{ value: productCount }] = await db.select({ value: count() }).from(products);
      if (productCount === 0) {
        logger.info("Empty catalog detected — seeding...");
        await runSeed();
        logger.info("Seed complete.");
      }
    } else {
      logger.info("DB_AUTO_SEED=false — skipping boot seeding.");
    }
  } catch (err) {
    logger.error({ err }, "Bootstrap (migrate/seed) failed");
    process.exit(1);
  }
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
