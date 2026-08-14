import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { env } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./lib/http.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import authRoutes from "./routes/auth.routes.js";
import productRoutes from "./routes/products.routes.js";
import orderRoutes from "./routes/orders.routes.js";
import couponRoutes from "./routes/coupons.routes.js";
import userRoutes from "./routes/users.routes.js";
import settingRoutes from "./routes/settings.routes.js";
import contactRoutes from "./routes/contact.routes.js";
import paymentRoutes from "./routes/payments.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import healthRoutes from "./routes/health.routes.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true
    })
  );
  app.use(cookieParser());
  // Raw body for Stripe webhook signature verification — must run BEFORE express.json(),
  // otherwise the JSON parser consumes the stream and the signature check gets an empty body.
  app.use("/api/payments/webhook/stripe", express.raw({ type: "application/json" }), (req, _res, next) => {
    (req as any).rawBody = req.body;
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.redirect("/index.html");
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth", authRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/coupons", couponRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/settings", settingRoutes);
  app.use("/api/contact", contactRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/health", healthRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { logger };