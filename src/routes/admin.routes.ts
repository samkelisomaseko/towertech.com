import { Router } from "express";
import { asyncHandler } from "../lib/http.js";
import { requireAdmin } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { orders, products, users, orderItems, reviews } from "../db/schema.js";
import { sql } from "drizzle-orm";

const router = Router();

router.get(
  "/stats",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [orderAgg] = await db
      .select({
        count: sql<number>`count(*)`,
        revenue: sql<number>`coalesce(sum(total),0)`
      })
      .from(orders);
    const [productAgg] = await db.select({ count: sql<number>`count(*)` }).from(products);
    const [userAgg] = await db.select({ count: sql<number>`count(*)` }).from(users);
    const [reviewAgg] = await db.select({ count: sql<number>`count(*)` }).from(reviews);
    const [itemsAgg] = await db.select({ count: sql<number>`count(*)` }).from(orderItems);

    res.json({
      stats: {
        orders: Number(orderAgg?.count ?? 0),
        revenue: Number(orderAgg?.revenue ?? 0),
        products: Number(productAgg?.count ?? 0),
        users: Number(userAgg?.count ?? 0),
        reviews: Number(reviewAgg?.count ?? 0),
        items: Number(itemsAgg?.count ?? 0)
      }
    });
  })
);

export default router;