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

Production Compose requires explicitly supplied secrets and fails before starting when any required value is missing.

```bash
cp .env.production.example .env.production
# Edit .env.production with real production URLs, credentials, and secrets.
docker compose --env-file .env.production up --build
```

- App: the configured `APP_URL` (mapped from host port `APP_PORT`, default `3000`)
- Postgres: available only on the Compose internal network; it is not published to the host.

The server applies Drizzle migrations and seeds the database (admin, catalog, coupons) on boot
when `DB_AUTO_MIGRATE`/`DB_AUTO_SEED` are true (local-development default). Production Compose
sets both to `false`: DDL and seeding are explicit deploy steps, never app-boot side effects.

Production deploy order:

```bash
docker compose --env-file .env.production up --build -d postgres
docker compose --env-file .env.production run --rm app node dist/db/migrate.js
docker compose --env-file .env.production up --build -d app
docker compose --env-file .env.production exec app node dist/db/seed.js  # first deploy / credential cleanup only
```

Rollback: re-deploy the previous image/commit, then restore the pre-deploy backup above.
Do not roll back code without the matching backup — migrations are one-way.

Incident triage: payment failures surface in structured logs (`paymentStatus='failed'`,
`reconciliation:'mismatch'`, `MOMO_*`/`INSTACASH_*` error codes). `GET /api/health` reports
`status` plus a live database check; alert on anything but `{"status":"ok"}`.

Known single-instance limits: rate limiting is in-process memory (add a shared store before
running more than one app replica), and CSP remains off because the legacy frontend relies on
inline handlers — output encoding is the active XSS defense until that refactor lands.

```bash
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "towertech-$(date +%F-%H%M).sql"
```

Restore to a compatible empty database:

```bash
cat towertech-backup.sql | docker compose --env-file .env.production exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

After deploying this release, run the seed/cleanup once and then rotate every credential that was
previously stored or published as a development default:

```bash
docker compose --env-file .env.production exec app node dist/db/seed.js
```

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
| `npm run db:migrate` | Apply migrations (dev, via drizzle-kit) |
| `npm run db:migrate:dist` | Apply migrations from compiled `dist/` (production containers) |
| `npm run db:seed` | Seed database |
| `npm run db:studio` | Drizzle Studio |

## Architecture

- `src/app.ts` — Express app assembly (security headers, CORS, rate limiting, raw-body Stripe webhook before `express.json`).
- `src/routes/*` — API endpoints: auth, products (+reviews), orders, coupons, users, settings, contact/bugs, payments, AI, admin stats, health.
- `src/services/*` — Business logic: order totals (server-authoritative, `TAX_RATE = 0.15`), coupon validation, payment intents, email.
- `src/db/*` — Drizzle schema, migrations, seeding (admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`, coupons `CYBER20` 20% / `BETA50` 50%). Prices and orders use SZL (Lilangeni). `JWT_SECRET` and `ADMIN_PASSWORD` have no development defaults.
- `public/index.html` — the PWA; the in-browser `Database` class was replaced with an `ApiClient` facade exposing the same `get/getAll/put/delete/count/clearAll` interface mapped to REST endpoints. Checkout confirms Stripe Payment Intents client-side and surfaces MoMo/InstaCash payment instructions; the AI assistant calls the server `/api/ai/chat` endpoint.

## Key Behaviors

- Orders are computed and stock-locked server-side; the client never sends totals.
- Payments: card uses real Stripe PaymentIntents (confirmed client-side via Stripe.js Payment Element); MoMo uses MTN MoMo Collection request-to-pay with provider-confirmed reconciliation; InstaCash callbacks are held for provider/manual confirmation. Payment credentials are managed only through environment/secret-manager configuration, never through runtime admin settings. Unconfigured rails are hidden in checkout via the `/api/settings/public` `payments` flags.
- Numeric `numeric` DB columns are stored/returned as strings and coerced with `Number()` at the boundaries.
- Settings: public whitelist (`hero_config`, `site_name`, `currency`, plus server-supplied `stripePublishableKey`); secrets masked (`********`) in the admin view and skipped on save if unchanged. Environment-managed payment secrets are rejected by the settings API.
- Authentication sessions are revalidated against the current user record, so bans, restores, promotions, and demotions take effect immediately.
- Notifications are created server-side on order confirmation for signed-in users.
- Session restore uses the httpOnly cookie via `GET /api/auth/me`.

## Environment Variables

See `.env.example` for local development and `.env.production.example` for production Compose deployments
(server, database, JWT, rate limits, seed bootstrap, Stripe, SMTP).

## Gates

Per AGENTS.md, before any release: `npm run lint` (0 errors), `npm run typecheck`, `npm test`, `npm run build`.
