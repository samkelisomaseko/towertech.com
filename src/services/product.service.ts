import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { NewProduct, Product, products } from "../db/schema.js";
import { AppError, NotFoundError } from "../lib/http.js";

export const productInputSchema = z.object({
  name: z.string().min(1, "Name is required.").max(200),
  price: z.coerce.number().positive().multipleOf(0.01),
  stock: z.coerce.number().int().min(0).default(0),
  category: z.string().min(1, "Category is required.").max(100),
  img: z.string().url("Image must be a valid URL.").or(z.literal("")).optional().default(""),
  images: z.array(z.string().url()).optional().default([]),
  desc: z.string().default(""),
  specs: z.record(z.string(), z.string()).optional().default({}),
  sku: z.string().optional(),
  featured: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true)
});

export const productQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  maxPrice: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0)
});

function serialize(p: Product) {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    price: Number(p.price),
    category: p.category,
    stock: p.stock,
    img: p.img,
    images: p.images,
    desc: p.desc,
    specs: p.specs,
    featured: p.featured,
    active: p.active
  };
}

export type SerializedProduct = ReturnType<typeof serialize>;

export async function listProducts(filters: z.infer<typeof productQuerySchema>): Promise<SerializedProduct[]> {
  const rows = await db.query.products.findMany({
    where: (t, { and, eq, like, sql }) => {
      const conds: any[] = [eq(t.active, true)];
      if (filters.search) conds.push(like(t.name, `%${filters.search}%`));
      if (filters.category && filters.category !== "all") conds.push(eq(t.category, filters.category));
      if (filters.maxPrice != null) conds.push(sql`${t.price} <= ${filters.maxPrice}`);
      return and(...conds);
    },
    orderBy: [asc(products.id)],
    limit: filters.limit,
    offset: filters.offset
  });
  return rows.map(serialize);
}

export async function getAllProducts(): Promise<SerializedProduct[]> {
  const rows = await db.select().from(products).orderBy(asc(products.id));
  return rows.map(serialize);
}

export async function getProduct(id: number, includeInactive = false): Promise<SerializedProduct> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw new NotFoundError("Product");
  if (!row.active && !includeInactive) throw new NotFoundError("Product");
  return serialize(row);
}

export async function createProduct(input: z.infer<typeof productInputSchema>): Promise<SerializedProduct> {
  const now = new Date();
  const insert: NewProduct = {
    ...input,
    price: input.price.toFixed(2),
    createdAt: now,
    updatedAt: now
  };
  const [row] = await db.insert(products).values(insert).returning();
  return serialize(row);
}

export async function updateProduct(id: number, input: z.infer<typeof productInputSchema>): Promise<SerializedProduct> {
  const existing = await getProduct(id, true);
  if (!existing) throw new NotFoundError("Product");
  const [row] = await db
    .update(products)
    .set({ ...input, price: input.price.toFixed(2), updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return serialize(row);
}

export async function deleteProduct(id: number): Promise<void> {
  const existing = await db.select().from(products).where(eq(products.id, id));
  if (!existing.length) throw new NotFoundError("Product");
  await db.delete(products).where(eq(products.id, id));
}

export async function adjustStock(id: number, delta: number): Promise<void> {
  const [row] = await db.select().from(products).where(eq(products.id, id));
  if (!row) throw new NotFoundError("Product");
  const newStock = row.stock + delta;
  if (newStock < 0) throw new AppError(409, `Insufficient stock for ${row.name}. Available: ${row.stock}`, "INSUFFICIENT_STOCK");
  await db.update(products).set({ stock: newStock, updatedAt: new Date() }).where(eq(products.id, id));
}
