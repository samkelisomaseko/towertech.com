import { Router } from "express";
import { pingDatabase } from "../db/index.js";

const router = Router();

router.get("/", async (_req, res) => {
  const dbUp = await pingDatabase();
  res.json({ status: dbUp ? "ok" : "degraded", uptime: process.uptime(), db: dbUp ? "up" : "down" });
});

export default router;