import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config.js";
import { logger } from "../lib/logger.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
    });
  }
  return transporter;
}

export interface OrderConfirmationEmail {
  to: string;
  orderId: string;
  total: number;
  name: string;
}

export async function sendOrderConfirmation(
  to: string,
  order: { id: string; total: number; items: Array<{ name: string; qty: number; price: number }>; name?: string }
): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    logger.info("SMTP not configured; skipping order confirmation email.");
    return false;
  }
  try {
    const itemsHtml = order.items
      .map((i) => `<li>${i.qty} × ${i.name} — E${i.price.toFixed(2)}</li>`)
      .join("");
    await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `TowerTech Order Confirmation ${order.id}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2>Order Confirmed — TowerTech</h2>
          <p>Hi ${order.name ?? "there"}, your order <strong>${order.id}</strong> has been received.</p>
          <ul>${itemsHtml}</ul>
          <p>Total: <strong>E${order.total.toFixed(2)}</strong></p>
        </div>`
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send order confirmation email");
    return false;
  }
}

export async function sendContactNotification(to: string, type: "contact" | "bug", body: string): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `TowerTech ${type === "bug" ? "Bug Report" : "Contact Message"}`,
      text: body
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Failed to send contact notification email");
    return false;
  }
}