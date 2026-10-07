import { fileURLToPath } from "node:url";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { db } from "./index.js";
import { products, users, coupons, settings } from "./schema.js";
import { MANAGED_SETTING_SECRET_KEYS } from "../services/payment-credentials.js";
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

  // SZL starter catalog (Eswatini first-sale range, prices in Emalangeni ending 99)
  const catalog = [
    { name: "Aero Earbuds Lite", price: "349.99", category: "Audio", stock: 40, featured: false, img: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600", desc: "Budget true wireless earbuds with clear sound and charging case." },
    { name: "Aero Earbuds Pro", price: "899.99", category: "Audio", stock: 25, featured: true, img: "https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=600", desc: "ANC true wireless with spatial audio and long battery." },
    { name: "Pulse Smart Watch S1", price: "1299.99", category: "Wearables", stock: 20, featured: false, img: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600", desc: "Health tracking smart watch with 14-day battery." },
    { name: "Volt Charger + Cable Kit", price: "299.99", category: "Accessories", stock: 60, featured: false, img: "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600", desc: "Fast charger plus braided USB-C cable kit." },
    { name: "Shield Phone Covers Bundle", price: "199.99", category: "Accessories", stock: 80, featured: false, img: "https://images.unsplash.com/photo-1601593346740-925612772716?w=600", desc: "Bundle of durable phone covers in assorted colours." }
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
        title: "Quality Tech,\nPriced in Emalangeni",
        desc: "Earbuds, smart watches, chargers and accessories — priced in SZL (E) with fast delivery across Eswatini: Mbabane, Manzini and nationwide."
      })
    },
    { key: "momoEnvironment", value: env.MOMO_TARGET_ENVIRONMENT ?? "sandbox" },
    { key: "momoCallbackUrl", value: env.MOMO_CALLBACK_URL ?? "" },
    { key: "instaEndpoint", value: env.INSTACASH_ENDPOINT ?? "" }
  ];
  for (const s of settingsRows) {
    await db
      .insert(settings)
      .values({ ...s, updatedAt: new Date() })
      .onConflictDoNothing();
  }

  // Remove legacy runtime payment secrets. Credentials are now managed only through
  // environment/secret-manager configuration.
  await db.delete(settings).where(inArray(settings.key, [...MANAGED_SETTING_SECRET_KEYS]));

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