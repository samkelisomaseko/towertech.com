import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createApp, logger } from "./app.js";
import { env } from "./config.js";
import { db, pingDatabase, pool } from "./db/index.js";
import { products } from "./db/schema.js";
import { runSeed } from "./db/seed.js";
import { count } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = createApp();
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir, { index: "index.html", maxAge: "1h" }));

const server = createServer(app);
const port = env.PORT;

server.listen(port, async () => {
  const dbUp = await pingDatabase();
  logger.info({ port, env: env.NODE_ENV, db: dbUp ? "connected" : "UNAVAILABLE" }, "TowerTech server started");
  if (!dbUp) {
    logger.warn("Database unreachable — verify DATABASE_URL and run migrations.");
    return;
  }

  try {
    // Apply schema migrations and seed an empty catalog on boot.
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });
    logger.info("Migrations applied.");

    const [{ value: productCount }] = await db.select({ value: count() }).from(products);
    if (productCount === 0) {
      logger.info("Empty catalog detected — seeding...");
      await runSeed();
      logger.info("Seed complete.");
    }
  } catch (err) {
    logger.error({ err }, "Bootstrap (migrate/seed) failed");
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
