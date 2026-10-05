import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { env } from "../config.js";
import { listProducts } from "./product.service.js";
import { listCoupons } from "./coupon.service.js";

export interface AiContext {
  page?: string;
  lastProduct?: number | null;
  isAdmin?: boolean;
}

export interface AiActionResult {
  navigate?: string;
  addToCart?: number[];
  compare?: number[];
}

export interface AiResponse {
  message: string;
  action?: AiActionResult;
}

const MONEY = (n: number) =>
  "E" + n.toLocaleString("en-SZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function getAiConfig(): Promise<{ enabled: boolean; model: string; apiKey: string }> {
  let model = env.AI_MODEL ?? "deepseek/deepseek-chat";
  let apiKey = env.AI_API_KEY ?? "";
  let enabled = env.AI_ENABLED ?? true;
  try {
    const rows = await db.select().from(settings);
    const map = new Map(rows.map((r) => [String(r.key), String(r.value)]));
    if (map.get("ai_model")) model = String(map.get("ai_model"));
    if (map.get("ai_api_key") && map.get("ai_api_key") !== "********") apiKey = String(map.get("ai_api_key"));
    if (map.get("ai_enabled") !== undefined) {
      const v = String(map.get("ai_enabled")).toLowerCase();
      enabled = v === "true" || v === "1" || v === "yes";
    }
  } catch {
    // settings table unavailable (e.g. unit tests) — fall back to env
  }
  return { enabled, model, apiKey };
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Search the live product catalog by keyword and optional max price in Emalangeni.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword to match against name or category" },
          maxPrice: { type: "number", description: "Maximum price in E" },
          limit: { type: "integer", description: "Max results", default: 5 }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "product_price",
      description: "Get the current price and stock for a product by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_coupons",
      description: "List currently active discount codes."
    }
  }
];

function renderProductCards(matches: { id: number; name: string; price: number; stock: number }[]): string {
  const top = matches.slice(0, 3);
  let html = `Found ${matches.length} matching product${matches.length > 1 ? "s" : ""}:<br>`;
  html += top
    .map((p) => {
      const stockColor = p.stock > 0 ? "#00aa6c" : "#d9534f";
      return `
          <div style="margin-top:10px; background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; border-left:2px solid var(--primary);">
            <div style="font-weight:bold;">${escapeHtml(p.name)}</div>
            <div style="font-size:0.9rem; color:var(--text-muted);">${MONEY(p.price)} <span style="color:${stockColor}">• ${p.stock > 0 ? "In Stock" : "Out"}</span></div>
            <div style="margin-top:5px; display:flex; gap:10px;">
              <a href="#product?id=${p.id}" class="btn-link">View</a>
              ${p.stock > 0 ? `<button class="btn-link" onclick="window.app.commerce.addByPrompt(${p.id})">Add to Cart</button>` : ""}
            </div>
          </div>`;
    })
    .join("");
  return html;
}

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "search_products") {
    const q = typeof args.query === "string" ? args.query : "";
    const maxPrice = typeof args.maxPrice === "number" ? args.maxPrice : undefined;
    const limit = typeof args.limit === "number" ? Math.min(Math.max(args.limit, 1), 10) : 5;
    const products = await listProducts({ limit: 100, offset: 0 });
    const matches = products.filter(
      (p) =>
        p.active &&
        (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.category.toLowerCase().includes(q.toLowerCase())) &&
        (maxPrice === undefined || p.price <= maxPrice)
    );
    return matches.slice(0, limit).map((p) => ({ id: p.id, name: p.name, price: p.price, stock: p.stock, category: p.category }));
  }
  if (name === "product_price") {
    const products = await listProducts({ limit: 100, offset: 0 });
    const match = products.find((p) => p.name.toLowerCase().includes(String(args.name ?? "").toLowerCase()));
    return match ? { name: match.name, price: match.price, stock: match.stock } : null;
  }
  if (name === "list_coupons") {
    const coupons = (await listCoupons()).filter((c) => c.active);
    return coupons.map((c) => ({ code: c.code, discount: Number(c.discount) }));
  }
  return null;
}

/**
 * Server-side intent processor. Uses OpenRouter when configured (admin
 * ai_model/ai_api_key/ai_enabled settings, env fallback); otherwise falls
 * back to the deterministic regex router so chat never breaks offline.
 */
export async function processAiIntent(text: string, _ctx: AiContext): Promise<AiResponse> {
  const cfg = await getAiConfig();
  if (cfg.enabled && cfg.apiKey) {
    try {
      return await processWithLlm(text, cfg.model, cfg.apiKey);
    } catch {
      // fall through to deterministic router
    }
  }
  return processLocal(text);
}

async function processWithLlm(text: string, model: string, apiKey: string): Promise<AiResponse> {
  const system =
    "You are TowerTech's store assistant for an Eswatini electronics shop (prices in Emalangeni, E). " +
    "Use the provided tools for product search, prices and coupons — never invent products, prices or codes. " +
    "Reply in one or two short sentences plus the product cards the tools return. Keep the rich HTML card format.";
  const first = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://towertech.sz", "X-Title": "TowerTech Assistant" },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: text }], tools: TOOLS, tool_choice: "auto", max_tokens: 600 })
  });
  if (!first.ok) throw new Error(`llm ${first.status}`);
  const data = (await first.json()) as {
    choices?: { message?: { content?: string; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  };
  const msg = data.choices?.[0]?.message;
  const calls = msg?.tool_calls ?? [];
  if (calls.length === 0) return { message: escapeHtml(msg?.content?.trim() || "How else can I help?") };

  const toolResults: { tool_call_id?: string; role: string; name: string; content: string }[] = [];
  let cardHtml = "";
  const addToCart: number[] = [];
  for (const [i, call] of calls.slice(0, 3).entries()) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    const result = await runTool(call.function.name, args);
    toolResults.push({ tool_call_id: String(i), role: "tool", name: call.function.name, content: JSON.stringify(result) });
    if (call.function.name === "search_products" && Array.isArray(result) && result.length > 0) {
      const rows = result as { id: number; name: string; price: number; stock: number }[];
      cardHtml = renderProductCards(rows);
      for (const r of rows.slice(0, 3)) if (r.stock > 0) addToCart.push(r.id);
    }
  }
  const second = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://towertech.sz", "X-Title": "TowerTech Assistant" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
        { role: "assistant", content: msg?.content ?? "", tool_calls: calls },
        ...toolResults
      ],
      max_tokens: 400
    })
  });
  if (!second.ok) {
    if (cardHtml) return { message: cardHtml, action: addToCart.length ? { addToCart } : undefined };
    throw new Error(`llm ${second.status}`);
  }
  const data2 = (await second.json()) as { choices?: { message?: { content?: string } }[] };
  const text2 = data2.choices?.[0]?.message?.content?.trim() || "";
  const safe = escapeHtml(text2);
  return { message: cardHtml ? `${safe}<br>${cardHtml}` : safe, action: addToCart.length ? { addToCart } : undefined };
}

export async function processLocal(text: string): Promise<AiResponse> {
  const lower = text.toLowerCase();
  const products = await listProducts({ limit: 100, offset: 0 });

  if (/go to|open|show me|navigate|take me to/.test(lower)) {
    if (lower.includes("home")) return { message: "Taking you to the home page.", action: { navigate: "home" } };
    if (lower.includes("cart")) return { message: "Opening your cart.", action: { navigate: "cart" } };
    if (lower.includes("wishlist")) return { message: "Showing your wishlist.", action: { navigate: "wishlist" } };
    if (lower.includes("contact")) return { message: "Opening the contact page.", action: { navigate: "contact" } };
    if (lower.includes("compare")) return { message: "Opening the comparison tool.", action: { navigate: "compare" } };
    if (lower.includes("dashboard")) return { message: "Opening your dashboard.", action: { navigate: "dashboard" } };
    if (lower.includes("admin")) return { message: "Admin access requires an admin account." };
    if (lower.includes("shop") || lower.includes("catalog") || lower.includes("store")) {
      return { message: "Opening the store.", action: { navigate: "shop" } };
    }
  }

  if (/find|search|show|what is|list|available/.test(lower)) {
    const query = lower
      .replace(/find|search|show|me|the|what is|list|available/g, "")
      .trim()
      .replace(/^[^a-z0-9]+/, "");
    const matches = products.filter(
      (p) =>
        (!query || p.name.toLowerCase().includes(query) || p.category.toLowerCase().includes(query)) && p.active
    );
    if (matches.length > 0) {
      const top = matches.slice(0, 3);
      return { message: renderProductCards(matches), action: { addToCart: top.filter((p) => p.stock > 0).map((p) => p.id) } };
    }
    return { message: "No matching products found." };
  }

  if (/how much|price|cost/.test(lower)) {
    const query = lower.replace(/how much is|price of|cost of|the|for/g, "").trim();
    const match = products.find((p) => p.name.toLowerCase().includes(query));
    if (match)
      return {
        message: `The <strong>${escapeHtml(match.name)}</strong> is currently listed at <span style="color:var(--accent); font-weight:bold; font-family:var(--font-tech)">${MONEY(match.price)}</span>.`
      };
    return { message: "Please tell me the product name you want a price for." };
  }

  if (lower.includes("compare")) {
    const terms = lower.replace("compare", "").split(/and|vs|with|,/);
    const matches: typeof products = [];
    terms.forEach((term) => {
      const clean = term.trim().toLowerCase();
      if (clean.length > 2) {
        const found = products.find((p) => p.name.toLowerCase().includes(clean));
        if (found) matches.push(found);
      }
    });
    if (matches.length >= 2) {
      const ids = [...new Set(matches.map((m) => m.id))].slice(0, 4);
      return {
        message: `Comparing <strong>${matches.map((m) => escapeHtml(m.name)).join(" & ")}</strong>. <br><a href="#compare" class="btn-link">Open Comparison</a>`,
        action: { compare: ids, navigate: "compare" }
      };
    }
    return { message: "Name at least two products to compare." };
  }

  if (/stock|have|units/.test(lower)) {
    const query = lower.replace(/stock|available|do you have|units|in/g, "").trim();
    const match = products.find((p) => p.name.toLowerCase().includes(query));
    if (match)
      return {
        message: `<strong>${escapeHtml(match.name)}</strong>: ${match.stock > 0 ? `<span style="color:var(--accent)">${match.stock} units in stock</span>` : '<span style="color:var(--error)">Out of stock</span>'}.`
      };
  }

  if (/how many|catalog|inventory|stock of all/.test(lower)) {
    const total = products.reduce((a, p) => a + p.stock, 0);
    return { message: `Inventory: <strong>${products.length}</strong> products, <strong>${total}</strong> units total.` };
  }

  if (/hello|hi|hey/.test(lower)) return { message: "Hello! How can I help you today?" };
  if (/coupon|discount|code/.test(lower)) {
    const coupons = (await listCoupons()).filter((c) => c.active);
    if (coupons.length === 0) return { message: "There are no active discount codes right now." };
    const codes = coupons.map((c) => `<strong>${escapeHtml(c.code)}</strong> (${Math.round(Number(c.discount) * 100)}% off)`).join(", ");
    return { message: `Active codes: ${codes}. Apply one at checkout.` };
  }
  if (/help|capabilities|what can you/.test(lower))
    return { message: "I can help with: product search, price checks, stock status, comparisons, and navigation." };

  return { message: "I didn't understand that. Try asking about products, prices, stock, or coupons." };
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
