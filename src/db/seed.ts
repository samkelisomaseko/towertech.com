import { fileURLToPath } from "node:url";
import path from "node:path";
import { db } from "./index.js";
import { products, users, coupons, settings } from "./schema.js";
import { env } from "../config.js";
import { hashPassword } from "../lib/crypto.js";

export async function runSeed(): Promise<void> {
  console.log("🌱 Seeding TowerTech database...");

  // Admin user
  const adminHash = hashPassword(env.ADMIN_PASSWORD);
  await db
    .insert(users)
    .values({
      email: env.ADMIN_EMAIL.toLowerCase(),
      name: "TowerTech Admin",
      passwordHash: adminHash,
      salt: "",
      role: "admin",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .onConflictDoNothing();

  // Demo products (same catalog as the original single-file app)
  const catalog = [
    { name: "Quantum Laptop X1", price: "1899.99", category: "Laptops", stock: 12, featured: true, img: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600", desc: "Flagship ultralight with quantum-core processor." },
    { name: "Nova Smartphone S23", price: "899.99", category: "Phones", stock: 30, featured: true, img: "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600", desc: "6.7\" AMOLED, 108MP camera system." },
    { name: "Aurora Earbuds Pro", price: "129.99", category: "Audio", stock: 45, featured: true, img: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600", desc: "ANC true wireless with spatial audio." },
    { name: "Titan Gaming Monitor 27\"", price: "449.99", category: "Monitors", stock: 8, featured: false, img: "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=600", desc: "165Hz QHD 1ms response." },
    { name: "Pulse Smart Watch", price: "199.99", category: "Wearables", stock: 25, featured: false, img: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600", desc: "Health tracking with 14-day battery." },
    { name: "Vertex Desktop GPU", price: "799.99", category: "Components", stock: 6, featured: false, img: "https://images.unsplash.com/photo-1591488320449-011701bb6704?w=600", desc: "Next-gen ray tracing acceleration." }
  ];

  for (const p of catalog) {
    await db
      .insert(products)
      .values({
        ...p,
        images: [p.img],
        specs: { Processor: "Latest gen", Memory: "16GB" },
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .onConflictDoNothing();
  }

  // Coupons (same as original: CYBER20, BETA50)
  const couponRows = [
    { code: "CYBER20", discount: "0.2000", desc: "20% off cyber week", maxUses: 500, uses: 0, active: true },
    { code: "BETA50", discount: "0.5000", desc: "50% off beta launch", maxUses: 100, uses: 0, active: true }
  ];
  for (const c of couponRows) {
    await db
      .insert(coupons)
      .values({ ...c, createdAt: new Date() })
      .onConflictDoNothing();
  }

  // Default settings
  const settingsRows = [
    { key: "site_name", value: "TowerTech" },
    { key: "currency", value: "SZL" },
    {
      key: "hero_config",
      value: JSON.stringify({
        img: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800",
        title: "High-Performance\nTECHNOLOGY",
        desc: "Electronics, computing, and accessories — delivered across Eswatini. Trusted quality, fair prices, fast delivery."
      })
    },
    { key: "stripeKey", value: env.STRIPE_PUBLISHABLE_KEY ?? "" },
    { key: "momoSubscriptionKey", value: env.MOMO_SUBSCRIPTION_KEY ?? "" },
    { key: "momoApiUser", value: env.MOMO_API_USER ?? "" },
    { key: "momoApiKey", value: env.MOMO_API_KEY ?? "" },
    { key: "momoEnvironment", value: env.MOMO_TARGET_ENVIRONMENT ?? "sandbox" },
    { key: "momoCallbackUrl", value: env.MOMO_CALLBACK_URL ?? "" },
    { key: "instaEndpoint", value: env.INSTACASH_ENDPOINT ?? "" },
    { key: "instaApiKey", value: env.INSTACASH_API_KEY ?? "" }
  ];
  for (const s of settingsRows) {
    await db
      .insert(settings)
      .values({ ...s, updatedAt: new Date() })
      .onConflictDoNothing();
  }

  console.log("✅ Seed complete.");
}

// Run as a standalone script: `npm run db:seed`
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Seed failed:", err);
      process.exit(1);
    });
}