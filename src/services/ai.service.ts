import { listProducts } from "./product.service.js";
import { listCoupons } from "./coupon.service.js";

export interface AiContext {
  page?: string;
  lastProduct?: number | null;
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

/**
 * Server-side intent processor backed by the real catalog and live coupons.
 * Returns display-ready HTML plus optional structured actions for the client to execute.
 */
export async function processAiIntent(text: string, _ctx: AiContext): Promise<AiResponse> {
  const lower = text.toLowerCase();
  const products = await listProducts({ limit: 100, offset: 0 });

  // ---- NAVIGATION ----
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

  // ---- PRODUCT SEARCH ----
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
      return {
        message: html,
        action: { addToCart: top.filter((p) => p.stock > 0).map((p) => p.id) }
      };
    }
    return { message: "No matching products found." };
  }

  // ---- PRICE CHECK ----
  if (/how much|price|cost/.test(lower)) {
    const query = lower.replace(/how much is|price of|cost of|the|for/g, "").trim();
    const match = products.find((p) => p.name.toLowerCase().includes(query));
    if (match)
      return {
        message: `The <strong>${escapeHtml(match.name)}</strong> is currently listed at <span style="color:var(--accent); font-weight:bold; font-family:var(--font-tech)">${MONEY(match.price)}</span>.`
      };
    return { message: "Please tell me the product name you want a price for." };
  }

  // ---- COMPARISON ----
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

  // ---- STOCK CHECK ----
  if (/stock|have|units/.test(lower)) {
    const query = lower.replace(/stock|available|do you have|units|in/g, "").trim();
    const match = products.find((p) => p.name.toLowerCase().includes(query));
    if (match)
      return {
        message: `<strong>${escapeHtml(match.name)}</strong>: ${match.stock > 0 ? `<span style="color:var(--accent)">${match.stock} units in stock</span>` : '<span style="color:var(--error)">Out of stock</span>'}.`
      };
  }

  // ---- CATALOG STATS ----
  if (/how many|catalog|inventory|stock of all/.test(lower)) {
    const total = products.reduce((a, p) => a + p.stock, 0);
    return {
      message: `Inventory: <strong>${products.length}</strong> products, <strong>${total}</strong> units total.`
    };
  }

  // ---- SYSTEM ----
  if (/hello|hi|hey/.test(lower)) return { message: "Hello! How can I help you today?" };
  if (/coupon|discount|code/.test(lower)) {
    const coupons = (await listCoupons()).filter((c) => c.active);
    if (coupons.length === 0) return { message: "There are no active discount codes right now." };
    const codes = coupons.map((c) => `<strong>${escapeHtml(c.code)}</strong> (${Math.round(c.discount * 100)}% off)`).join(", ");
    return { message: `Active codes: ${codes}. Apply one at checkout.` };
  }
  if (/help|capabilities|what can you/.test(lower))
    return {
      message: "I can help with: product search, price checks, stock status, comparisons, and navigation."
    };

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