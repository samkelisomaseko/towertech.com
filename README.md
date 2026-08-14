# TowerTech — Ultimate Monolith

TowerTech is a premium electronics marketplace PWA. This repository converts the original single-file, client-side app (`public/index.html`, IndexedDB) into a production monolith: an **Express + PostgreSQL + Drizzle** backend that serves the static UI, now backed by a real REST API.

## Stack

| Layer | Tech |
|-------|------|
| Server | Node.js 20, Express 4, TypeScript (ESM) |
| Database | PostgreSQL 16, Drizzle ORM |
| Validation | Zod |
| Auth | scrypt password hashing, JWT in an httpOnly cookie (`tt_session`) |
| Payments | Stripe (real PaymentIntent) + MTN MoMo Collection (Eswatini) + configurable InstaCash adapter, SZL currency |
| Email | Nodemailer (SMTP, optional) |
| Frontend | Static PWA (`public/index.html`) with an in-page REST `ApiClient` facade replacing IndexedDB |
| Testing | Vitest |

## Quick Start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

- App: http://localhost:3000
- Postgres: `postgres://towertech:towertech@localhost:5432/towertech`

The server auto-runs Drizzle migrations and seeds the database (admin, catalog, coupons) on boot.

## Local Development

Prerequisites: Node 20+, a local PostgreSQL instance.

```bash
npm ci
cp .env.example .env       # point DATABASE_URL at your Postgres
npm run db:migrate         # apply schema migrations (drizzle-kit migrate)
npm run db:seed            # optional, seed runs automatically too
npm run dev                # tsx watch, http://localhost:3000
```

> **Never run `drizzle push`.** Schema changes go through `npm run db:generate` → `npm run db:migrate`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start dev server with hot reload |
| `npm start` | Run compiled `dist/` build |
| `npm run build` | TypeScript compile |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (full suite, `--pool=forks`) |
| `npm run db:generate` | Drizzle migration generation |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed database |
| `npm run db:studio` | Drizzle Studio |

## Architecture

- `src/app.ts` — Express app assembly (security headers, CORS, rate limiting, raw-body Stripe webhook before `express.json`).
- `src/routes/*` — API endpoints: auth, products (+reviews), orders, coupons, users, settings, contact/bugs, payments, AI, admin stats, health.
- `src/services/*` — Business logic: order totals (server-authoritative, `TAX_RATE = 0.15`), coupon validation, payment intents, email.
- `src/db/*` — Drizzle schema, migrations, seeding (admin `admin@towertech.com` / `towertechIT31A`, coupons `CYBER20` 20% / `BETA50` 50%). Prices and orders use SZL (Lilangeni).
- `public/index.html` — the PWA; the in-browser `Database` class was replaced with an `ApiClient` facade exposing the same `get/getAll/put/delete/count/clearAll` interface mapped to REST endpoints. Checkout confirms Stripe Payment Intents client-side and surfaces MoMo/InstaCash payment instructions; the AI assistant calls the server `/api/ai/chat` endpoint.

## Key Behaviors

- Orders are computed and stock-locked server-side; the client never sends totals.
- Payments: card uses real Stripe PaymentIntents (confirmed client-side via Stripe.js Payment Element); MoMo uses MTN MoMo Collection request-to-pay with a webhook (`/api/payments/webhook/momo`); InstaCash is a configurable gateway adapter (endpoint + API key required). Unconfigured rails are hidden in checkout via the `/api/settings/public` `payments` flags.
- Numeric `numeric` DB columns are stored/returned as strings and coerced with `Number()` at the boundaries.
- Settings: public whitelist (`hero_config`, `stripeKey`, `site_name`, `currency`); secrets masked (`********`) in the admin view and skipped on save if unchanged.
- Notifications are created server-side on order confirmation for signed-in users.
- Session restore uses the httpOnly cookie via `GET /api/auth/me`.

## Environment Variables

See `.env.example` for the full list (server, database, JWT, rate limits, seed bootstrap, Stripe, SMTP).

## Gates

Per AGENTS.md, before any release: `npm run lint` (0 errors), `npm run typecheck`, `npm test`, `npm run build`.
