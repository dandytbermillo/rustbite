# Rushbite Kiosk

A touch-screen self-ordering kiosk for a quick-service restaurant in Sherwood
Park, Alberta. Built with Next.js 15 (App Router), React 19, TypeScript,
PostgreSQL, Prisma, and Tailwind CSS.

Includes five surfaces:

- **Kiosk** — customer ordering flow (welcome → order type → menu → customize
  → cart → payment → confirmation).
- **Counter** — staff-facing cash collection surface for orders waiting on
  payment at the counter.
- **Kitchen Display System (KDS)** — staff-facing board; new orders appear in
  real time, staff advance them through `PREPARING` and `READY`.
- **Order Wallboard** — customer-facing display; preparing on the left, ready
  for pickup on the right, with a chime when a new order is ready.
- **Admin** — protected dashboard for menu CRUD and order history. During the
  auth migration window, both named admin sessions and legacy HTTP Basic auth
  are accepted.

## Prerequisites

- Node 20 or newer
- Docker (for the bundled Postgres container); any Postgres 16 also works

## Getting started

```bash
# 1. install
npm install

# 2. start Postgres (uses docker-compose.yml; host port 5433)
npm run db:up

# 3. migrate schema + seed menu data (40 items across 8 categories)
npm run db:migrate
npm run db:seed

# 4. run the app
npm run dev
```

When the dev server prints `Ready`, open one of:

| URL                                           | What it is                                       |
| --------------------------------------------- | ------------------------------------------------ |
| `http://localhost:3000/kiosk`                 | Customer-facing ordering flow                    |
| `http://localhost:3000/counter`               | Cash collection station                          |
| `http://localhost:3000/kitchen`               | Kitchen Display System                           |
| `http://localhost:3000/board`                 | Customer pickup wallboard                        |
| `http://localhost:3000/admin`                 | Admin (password from `ADMIN_PASSWORD`)           |
| `http://localhost:3000/`                      | Dev landing page linking to everything           |

If `ADMIN_PASSWORD` is unset in local development, the app falls back to
`change-me-in-prod`. In production, the app rejects unset, blank, or shipped-
default admin passwords.

To create the first named owner account, set `ADMIN_BOOTSTRAP_EMAIL`,
`ADMIN_BOOTSTRAP_NAME`, and `ADMIN_BOOTSTRAP_PASSWORD`, then run:

```bash
npm run auth:bootstrap-owner
```

Bootstrap is skipped once an active owner already exists.

### npm scripts

| Script           | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `npm run dev`    | Start the Next.js dev server (Turbopack)                    |
| `npm run build`  | Production build                                            |
| `npm run start`  | Run the production build                                    |
| `npm run db:up`  | Start the bundled Postgres container                        |
| `npm run db:down`| Stop the Postgres container                                 |
| `npm run db:migrate` | Run Prisma migrations                                   |
| `npm run db:seed`| Reseed menu from `prisma/seed.ts`                           |
| `npm run db:studio` | Open Prisma Studio                                       |
| `npm run db:reset` | Drop, re-migrate, and reseed                              |

## Environment variables

See `.env.example`. `.env.local` is created pre-configured for the local
Docker Postgres on port 5433.

| Var                           | Purpose                                    |
| ----------------------------- | ------------------------------------------ |
| `DATABASE_URL`                | Prisma connection string                   |
| `ADMIN_PASSWORD`              | Password for HTTP Basic on `/admin/*` (production rejects blank or shipped-default values) |
| `ADMIN_BOOTSTRAP_EMAIL`       | Initial owner email used by `npm run auth:bootstrap-owner` |
| `ADMIN_BOOTSTRAP_NAME`        | Initial owner display name used by owner bootstrap |
| `ADMIN_BOOTSTRAP_PASSWORD`    | Initial owner password used by owner bootstrap |
| `ADMIN_ALLOWED_ORIGINS`       | Comma-separated public admin origins accepted for state-changing admin requests |
| `LOGIN_RATE_LIMIT_SECRET`     | Secret used to hash stored login attempt subjects and IPs |
| `ALLOW_LEGACY_DEVICE_AUTH`    | Emergency/staging flag to re-enable legacy shared device keys; leave unset in production |
| `NEXT_PUBLIC_STORE_NAME`      | Shown in headers and confirmation screen   |
| `NEXT_PUBLIC_STORE_LOCATION`  | Shown on welcome screen                    |
| `NEXT_PUBLIC_KIOSK_ID`        | Two-digit kiosk identifier                 |
| `NEXT_PUBLIC_SERVICE_MODEL`   | `PICKUP_ONLY` or `TABLE_SERVICE`           |
| `NEXT_PUBLIC_PAYMENT_MODE`    | `MOCK` or `TERMINAL`                       |
| `NEXT_PUBLIC_PAYMENT_METHODS` | Comma list: `CARD,MOBILE,CASH`             |
| `NEXT_PUBLIC_SUPPORTED_LANGUAGES` | Comma list: `en,fr`                    |
| `NEXT_PUBLIC_PREP_MINUTES`    | Default readiness estimate on confirmation |
| `NEXT_PUBLIC_ORDER_RESET_SECONDS` | Confirmation auto-reset delay          |
| `KIOSK_DEVICE_KEY`            | Legacy shared kiosk code used only in local dev or an explicit legacy-device window |
| `COUNTER_DEVICE_KEY`          | Legacy shared counter code used only in local dev or an explicit legacy-device window |
| `KITCHEN_DEVICE_KEY`          | Legacy shared kitchen code used only in local dev or an explicit legacy-device window |
| `BOARD_DEVICE_KEY`            | Legacy shared board code used only in local dev or an explicit legacy-device window |
| `STRIPE_SECRET_KEY`           | Stripe secret key for Terminal payments      |
| `STRIPE_TERMINAL_READER_ID`   | Stripe Terminal reader ID                    |
| `STRIPE_TERMINAL_CURRENCY`    | In-person payment currency, default `cad`    |
| `GST_RATE`                    | Sales tax rate (0.05 = 5% GST, AB default) |
| `IMAGE_STORAGE_DRIVER`        | `local` (default) or `s3` — picks local-disk vs S3 driver |
| `IMAGE_LOCAL_UPLOAD_DIR`      | Absolute path for the local driver's upload root (default `<cwd>/var/uploads`; relative paths rejected) |
| `IMAGE_BUCKET_ENDPOINT`       | S3/R2 endpoint URL (blank for AWS default) — `IMAGE_STORAGE_DRIVER=s3` only |
| `IMAGE_BUCKET_REGION`         | `auto` for R2; AWS region for S3 — `s3` only |
| `IMAGE_BUCKET_NAME`           | Bucket name for product imagery — `s3` only  |
| `IMAGE_BUCKET_ACCESS_KEY_ID`  | Bucket access key — `s3` only                |
| `IMAGE_BUCKET_SECRET_ACCESS_KEY` | Bucket secret key — `s3` only             |
| `NEXT_PUBLIC_IMAGE_CDN_BASE`  | Public CDN URL fronting the bucket's live prefix — `s3` only |
| `IMAGE_PASTE_URL_ALLOWLIST`   | Comma-separated hosts accepted by the admin paste-URL escape hatch |

### Operating modes

The kiosk now has a small runtime config layer so you can align the UI with how
the store actually runs:

- `NEXT_PUBLIC_SERVICE_MODEL=PICKUP_ONLY` changes the copy to a cafeteria-style
  pickup flow instead of promising table delivery.
- `NEXT_PUBLIC_PAYMENT_MODE=MOCK` keeps the current demo behavior honest: orders
  are created, but the UI does not claim that a live payment was captured.
- `NEXT_PUBLIC_PAYMENT_METHODS` lets you hide unsupported tender types, such as
  cash on a card-only kiosk.
- `NEXT_PUBLIC_SUPPORTED_LANGUAGES=en` hides the French toggle until a real
  translated UI exists.

### Product imagery

The storage backend is pluggable:

- **Default — local disk.** Product photos are written to
  `IMAGE_LOCAL_UPLOAD_DIR` (default `<cwd>/var/uploads`) and served by
  a dedicated `/uploads/[...path]` route handler. This is the
  recommended topology for a single Raspberry Pi that runs admin +
  kiosk on the same box — no internet dependency, no monthly cost.
- **Opt-in — S3 / R2.** Set `IMAGE_STORAGE_DRIVER=s3` plus the
  `IMAGE_BUCKET_*` and `NEXT_PUBLIC_IMAGE_CDN_BASE` env vars, and the
  same admin UX writes straight to a bucket fronted by a CDN. Use
  this when admin and kiosks live on different hosts.

Admins upload via `/admin/menu` → item editor. Without an image, the
kiosk falls back to the existing emoji + background-color tile, so
the imagery pipeline is optional for early rollout.

For local dev, no env vars are required — the local driver creates
`var/uploads/` automatically on first use.

Deployment details (filesystem layout, backup cadence, reverse-proxy
body cap, S3 IAM minimum permissions) are documented in
[`docs/deploy-runbook.md`](./docs/deploy-runbook.md#product-imagery-storage).

### Device access

`/kiosk`, `/kitchen`, `/board`, and `/counter` now require a device session
before the surface opens. Operators are redirected to `/device-login`, where
they enter the enrolled access code for that physical device.

Production flow:

- sign in as the owner at `/admin/login`
- open `/admin/devices`
- create one device record per physical kiosk, counter, kitchen screen, or
  board
- assign the correct outlet scope
- copy the one-time access code shown at creation or rotation
- use that code on the device at `/device-login`

Device sessions are now database-backed and revocable per device. Disabling one
device or rotating one device code does not affect the others.

Legacy shared role keys still exist only as a compatibility fallback for local
development and short staging/emergency windows. Production should leave
`ALLOW_LEGACY_DEVICE_AUTH` unset.

Order APIs are no longer public:

- `/api/orders` is reserved for authenticated kiosk, counter, kitchen, or board
  devices.
- `/api/admin/*` remains protected by HTTP Basic auth.
- The admin UI now updates order state through `/api/admin/orders/[id]` instead
  of the public order routes.

### Order lifecycle

The kiosk now uses a clearer paid-to-kitchen lifecycle:

- `AWAITING_COUNTER_PAYMENT` — order exists, but staff still need to collect cash at the counter before prep begins.
- `PAID` — payment succeeded and the order is waiting for kitchen acknowledgement.
- `IN_KITCHEN` — kitchen staff started the order.
- `READY` — ready for pickup.
- `COMPLETED` — handed off to the customer.
- `CANCELLED` — cancelled before completion.
- `REFUNDED` — refunded through admin.

## Architecture

- **`src/app/kiosk`** — the state-machine page. Fetches `/api/menu` on mount
  and drives screens off `screen` state.
- **`src/components/kiosk`** — one component per screen (Welcome, OrderType,
  Menu, Customize, Cart, Payment, Confirmation) plus `TopBar`, `BadgeChip`,
  `CartSidebar`, `LargeTextToggle`.
- **`src/app/kitchen`, `src/app/board`** — polling UIs (3s `fetch`).
- **`src/app/admin/*`** — server components reading from Prisma; client
  components (`MenuEditor`, `OrdersTable`) call the admin API routes.
- **`src/app/api/*`** — Next.js route handlers.
- **`src/middleware.ts`** — HTTP Basic auth for `/admin/*` and `/api/admin/*`.
- **`prisma/schema.prisma`** — `Category`, `MenuItem`, `SizeOption`,
  `AddonOption`, `Order`, `OrderItem`.

### Server-side pricing

The `POST /api/orders` handler **recomputes all prices** from menu records
keyed by the IDs the client sent. The client's prices are never trusted. GST
rate comes from the `GST_RATE` env var.

### Realtime strategy

KDS and wallboard poll every 3 seconds via plain `fetch`. This is more than
adequate for a single-location kiosk. If you expand to many kiosks or need
sub-second latency, swap the `setInterval` in
`src/app/kitchen/page.tsx` and `src/app/board/page.tsx` for Server-Sent
Events or WebSockets (there is a `TODO` comment at each site).

### Accessibility

- All interactive tiles use `aria-label` / `aria-pressed` as appropriate.
- Touch targets are ≥ 48×48 px.
- A "LARGER TEXT" toggle (bottom-right on `/kiosk`) persists via
  `localStorage`, adds `text-lg-boost` to `<html>`, bumping the root font size.
- Design meets WCAG AA contrast on brand colors.

Full AODA / ACA compliance (wheelchair-height toggle, screen reader audio
cues, language switch) is **out of scope** for this build and is listed in
the TODOs below.

### Payment (TODO)

The kiosk now creates a persisted payment session before it creates an order.
In `MOCK` mode, that session is auto-approved for demos. In `TERMINAL` mode,
the backend uses a server-driven Stripe Terminal flow against the configured
reader and the kiosk polls the session until Stripe reports success or failure.
Cash uses a separate `COUNTER` payment provider: the kiosk creates the order,
marks it `AWAITING_COUNTER_PAYMENT`, and staff must mark it `PAID` from admin
before it appears on the kitchen screen. The customer board now shows those
orders in a separate `AWAITING PAYMENT` lane so the guest can still see their
order number immediately. A dedicated `/counter` surface now lets staff mark
cash orders received without using the admin dashboard.

- `src/app/api/payments/sessions/route.ts` creates and starts the payment.
- `src/app/api/payments/sessions/[id]/route.ts` polls and syncs payment state.
- `src/app/api/orders/route.ts` now creates the order from a successful payment
  session instead of trusting raw checkout input at the moment of order create.

**Current production path:** use **Stripe Terminal** server-driven integration
with a configured smart reader. Real-world flow:

1. Create a payment session and Stripe PaymentIntent on the server.
2. Hand the PaymentIntent to the configured reader.
3. Poll or consume webhooks until the payment is approved.
4. Create the order only after the payment session reaches a successful state,
   or hold the order in `AWAITING_COUNTER_PAYMENT` for cash.
5. On void/refund, reverse the Stripe transaction from admin.

Admin refund support is now implemented for `MOCK` payments and for
`STRIPE_TERMINAL` payments that have a persisted PaymentIntent reference.

Until that integration exists, keep `NEXT_PUBLIC_PAYMENT_MODE=MOCK` so the UI
does not misrepresent the system as a live payment deployment.

## Taxes

Hard-coded to Alberta: GST 5%, no PST. If expanding to other provinces you
will need a per-province lookup table and may need to show split tax lines on
the cart/confirmation screens.

## TODO list (not in this build)

- Moneris Checkout or Stripe Terminal integration (see above).
- Real food photography (the design uses emoji placeholders bundled with
  each menu item's `bgColor`).
- Multi-location support (today `kioskId` is from an env var).
- Loyalty / customer accounts.
- Bilingual UI (the EN/FR toggle on the welcome screen is cosmetic).
- Full AODA/ACA accessibility (wheelchair-height toggle, screen reader, ...).
- Receipt printing / email.
- Inventory / "86'd" item tracking from KDS.
- Move from `setInterval` polling to Server-Sent Events.

## Notes for operators

- To change the admin password, edit `ADMIN_PASSWORD` in `.env.local` and
  restart the dev server.
- In production, set a unique `ADMIN_PASSWORD` and unique device keys before
  exposing the app.
- To reset the menu, `npm run db:reset` drops and reseeds everything.
- To inspect the database, `npm run db:studio` opens Prisma Studio on
  `http://localhost:5555`.
