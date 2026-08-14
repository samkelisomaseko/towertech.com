import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  jsonb,
  boolean,
  timestamp,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";

// ---------------- USERS ----------------
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    salt: text("salt").notNull(),
    role: text("role").notNull().default("user"), // 'user' | 'admin'
    status: text("status").notNull().default("active"), // 'active' | 'banned'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)]
);

// ---------------- PRODUCTS ----------------
export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    sku: text("sku"),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    category: text("category").notNull(),
    stock: integer("stock").notNull().default(0),
    img: text("img"),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    desc: text("desc").notNull().default(""),
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    featured: boolean("featured").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("products_category_idx").on(t.category),
    index("products_name_idx").on(t.name),
    index("products_active_idx").on(t.active)
  ]
);

// ---------------- ORDERS ----------------
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(), // human-friendly order id e.g. ORD-XXXXXX
    userId: text("user_id"), // user email or null for guest
    isGuest: boolean("is_guest").notNull().default(true),
    status: text("status").notNull().default("Processing"), // Processing | Paid | Shipped | Delivered | Cancelled
    paymentMethod: text("payment_method"), // card | momo | instacash
    paymentStatus: text("payment_status").notNull().default("pending"), // pending | paid | failed
    paymentIntentId: text("payment_intent_id"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
    tax: numeric("tax", { precision: 12, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    couponCode: text("coupon_code"),
    shipping: jsonb("shipping").$type<{
      name: string;
      email: string;
      address: string;
      city: string;
      phone: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("orders_user_idx").on(t.userId),
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt)
  ]
);

// ---------------- ORDER ITEMS ----------------
export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull(),
    name: text("name").notNull(),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    img: text("img"),
    qty: integer("qty").notNull().default(1)
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);

// ---------------- REVIEWS ----------------
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id"), // user email
    userName: text("user_name").notNull(),
    rating: integer("rating").notNull(), // 1-5
    comment: text("comment").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("reviews_product_idx").on(t.productId)]
);

// ---------------- COUPONS ----------------
export const coupons = pgTable(
  "coupons",
  {
    code: text("code").primaryKey(),
    discount: numeric("discount", { precision: 5, scale: 4 }).notNull(), // 0.20 = 20%
    desc: text("desc").notNull().default(""),
    active: boolean("active").notNull().default(true),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("coupons_active_idx").on(t.active)]
);

// ---------------- NOTIFICATIONS ----------------
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    msg: text("msg").notNull(),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("notifications_user_idx").on(t.userId)]
);

// ---------------- SETTINGS (KEY-VALUE) ----------------
export const settings = pgTable(
  "settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("settings_key_idx").on(t.key)]
);

// ---------------- LOGS ----------------
export const logs = pgTable(
  "logs",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("logs_created_idx").on(t.createdAt)]
);

// ---------------- CONTACT / BUG MESSAGES ----------------
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull().default("contact"), // 'contact' | 'bug'
    name: text("name"),
    email: text("email"),
    subject: text("subject"),
    severity: text("severity"),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("messages_created_idx").on(t.createdAt)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Log = typeof logs.$inferSelect;
export type Message = typeof messages.$inferSelect;
