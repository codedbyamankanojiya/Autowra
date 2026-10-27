# Autowra — Build Plan

Autowra is an on-demand car & bike washing marketplace: customers book a wash at their
doorstep, independent partners accept and perform the job, and Autowra operations staff
manage pricing, supply, money and support from an admin dashboard.

This document is the living plan for the repository. It records the architecture, the
phases, what is done, what is in progress and what is deliberately deferred. It is updated
as work lands.

---

## 1. Products

| Product | Path | Stack | Purpose |
| --- | --- | --- | --- |
| Customer app | `apps/customer` | Expo SDK 58 + Expo Router + React Native 0.88 (TypeScript) | Browse, book, pay, track, manage vehicles/addresses, history, support |
| Partner app | `apps/partner` | Expo SDK 58 + Expo Router + React Native 0.88 (TypeScript) | Go online, accept jobs, advance job lifecycle, evidence photos, earnings |
| Backend API | `backend` | NestJS 12 + Prisma 6 + PostgreSQL 18 | Single source of truth: auth, catalogue, pricing, bookings, assignment, payments, ledgers, notifications |
| Admin dashboard | `apps/admin` | Next.js 16 (App Router) + Tailwind CSS v4 | Operations: catalogue, pricing, bookings, partners, money, support, reports, audit |

**Hard rule:** neither mobile app owns a booking database. All state flows through the
backend API. Mobile is treated as an untrusted client.

## 2. Repository layout

```
Autowra/
├── apps/
│   ├── customer/            Expo app (customer)
│   ├── partner/             Expo app (partner)
│   └── admin/               Next.js admin dashboard
├── packages/
│   ├── config/              Brand config + design tokens (shared)
│   ├── shared-types/        Enums, money helpers, domain models, API DTOs, presentation maps
│   ├── validation/          Zod schemas shared by API, both apps and admin
│   └── api-client/          Typed fetch client with refresh-on-401 + domain methods
├── backend/
│   ├── prisma/              schema.prisma, migrations, seed.ts
│   └── src/                 NestJS application
├── BUILD_PLAN.md
├── README.md
└── .env.example
```

npm workspaces (`apps/*`, `packages/*`, `backend`). Node >= 20.19.

### Dependency direction

```
shared-types  ──▶  validation  ──▶  api-client
      ▲                                  ▲
      └──────── config ──────────────────┘
                    │
   backend ─────────┴──────── apps/customer · apps/partner · apps/admin
```

`shared-types` has no dependencies. `validation` depends on `shared-types` + `zod`.
`api-client` depends on `shared-types`. The backend and all three front-ends consume the
same contracts — a change to a DTO breaks the build everywhere it matters.

## 3. Core engineering rules

1. **Money is integer minor units (paise).** Never floating point. `packages/shared-types/src/money.ts`
   is the only place conversion/formatting happens.
2. **The server owns the numbers.** Client-submitted totals, discounts, payment status and
   payouts are ignored; the server recomputes from the database.
3. **Payment status is separate from booking status.** A booking can be `CONFIRMED` with a
   payment that is `AUTHORIZED`, `CAPTURED`, `FAILED` or `REFUNDED`.
4. **Idempotency everywhere money or capacity moves.** Unique `idempotencyKey` columns on
   bookings, payments, refunds and subscription usage; unique constraint prevents a slot
   from being double-claimed.
5. **Domain enums are `as const` objects + union types**, not TypeScript `enum`, so the same
   file works in NestJS, Metro and Next.
6. **Secrets never enter the mobile bundle.** Only `EXPO_PUBLIC_*` values are exposed, and
   only non-sensitive ones.
7. **Integrations are adapters with an explicit simulation flag.** Local development uses
   labelled mock providers; each response carries `isSimulated` so the UI can say so.

## 4. Data model (Prisma / PostgreSQL)

Schema: `backend/prisma/schema.prisma`.

Identity & access: `User`, `AuthSession` (hashed refresh tokens, server-revocable),
`PushToken`, `OtpRequest`.
People: `CustomerProfile`, `PartnerProfile`, `PartnerDocument`, `PartnerServiceArea`.
Customer assets: `Vehicle`, `Address`.
Catalogue: `ServiceCategory`, `Service`, `ServiceSizePrice`, `ServiceAddon`,
`ServiceAddonLink`, `ServiceArea`, `AvailabilitySlot`.
Bookings: `Booking`, `BookingItem`, `BookingStatusHistory`, `PartnerAssignment`,
`CompletionPhoto`.
Money: `Payment`, `PaymentWebhookEvent`, `Refund`, `Invoice`, `Coupon`,
`CouponRedemption`, `CommissionRule`, `PartnerLedgerEntry`, `Payout`.
Subscriptions: `SubscriptionPlan`, `CustomerSubscription`, `SubscriptionUsage`.
Engagement: `Review`, `SupportTicket`, `SupportTicketMessage`, `Notification`, `AuditLog`,
`BusinessSetting`.

All money columns are `Int` (paise). All tables carry `createdAt`/`updatedAt`. Foreign keys
and the indexes that the hot queries need are declared in the schema.

## 5. Booking status model

```
PENDING_PAYMENT ─▶ CONFIRMED ─▶ ASSIGNED ─▶ PARTNER_ACCEPTED ─▶ TRAVELLING
                                                                    │
                                                                    ▼
                                          ARRIVED ─▶ IN_PROGRESS ─▶ COMPLETED
     (any pre-completion state) ─▶ CANCELLED
     (assignment exhausted)     ─▶ NO_PARTNER_FOUND
```

Legal transitions are defined once in `packages/shared-types/src/enums.ts`
(`BOOKING_STATUS_SEQUENCE`) and enforced server-side; the partner app only offers the
actions the server will accept.

## 6. Phases

### Phase 0 — Foundation ✅
- npm workspace root, shared `tsconfig.base.json`, `.gitignore`, `.env.example`.
- `packages/config` (brand + design tokens), `packages/shared-types` (enums, money, models,
  API DTOs, presentation), `packages/validation` (Zod), `packages/api-client` (typed client
  with one-shot refresh on 401).
- Full Prisma schema committed.
- Expo apps renamed/reconfigured (`@Autowra/customer`, `@Autowra/partner`), monorepo
  Metro config, brand `app.json`.
- Admin Next.js app renamed and reconfigured.

### Phase 1 — Backend milestone 1 (auth + catalogue + pricing) ✅
- Bootstrap: `main.ts`, `AppModule`, config module with Zod env validation, Prisma module,
  global validation pipe, exception filter, Swagger, helmet, rate limiting, CORS.
- Auth: OTP request/verify, dev-only OTP path, JWT access + refresh with hashed
  `AuthSession` rows, rotation and revocation, RBAC guards, `@CurrentUser()` decorator.
- Catalogue: services, categories, add-ons, size pricing, service areas, availability.
- Pricing engine: pure `PriceCalculator` (unit tests) used by quote + booking creation.
- Seed script: business settings, categories, 12+ services, add-ons, size prices, service
  areas, slots, commission rule, subscription plans, dev admin + partner accounts.

### Phase 2 — Backend milestone 2 (bookings + partners + money) 🔄 *in progress*
- ✅ Booking creation with idempotency, transaction, slot capacity guard, status history.
- ✅ Availability/reschedule/cancel with policy windows, cancellation fee + refund.
- ✅ Payments: `PaymentProvider` interface, `MockProvider` (clearly labelled) and Razorpay
  adapter, webhook verification, duplicate-event protection, refunds, invoice HTML.
- ✅ Customer-facing booking reads: list/detail/status, invoice render.
- ✅ Partner assignment engine: ranked candidates (service area, online state, skills, workload,
  distance), one live offer per job, offer TTL swept by cron, auto-reassign on rejection or
  timeout, every write a compare-and-set. Manual admin assignment reuses `offerTo` and lands
  with the admin module.
- ✅ Partner job endpoints with legal-transition enforcement, address/phone redaction until
  acceptance, issue reporting and before/after evidence photos.
- ✅ Ledger + commission + payouts, server-calculated only: `CommissionRule` resolution with a
  platform default, frozen per-offer commission, append-only partner ledger with running
  balance, idempotent settlement/reversal, payout claim by compare-and-set, IST business days.
- ✅ Partner onboarding: draft profile, service areas + skills, encrypted bank details, private
  KYC upload with authenticated download, verification submission, duty toggle, location
  heartbeat.
- ✅ Subscriptions: plans, purchase through the same verified payment pipeline as a booking
  (a plan stays `PENDING_PAYMENT` until the charge settles), server-computed validity window,
  visit allowance consumed once per booking via a unique `SubscriptionUsage` row with
  release-on-cancel, duplicate-coverage and vehicle-type guards, no auto-renewal.
- ✅ Reviews and support tickets: a review only for a completed booking the caller owns, one
  review per booking enforced by the unique index, partner rating recomputed from the review
  rows; tickets scoped to their creator (staff see the queue), booking reference validated
  against the caller's own bookings, internal notes hidden from customers, reply and status
  transitions that hand the thread back and forth.
- ⬜ Admin sections.
- ✅ Notifications + WebSocket gateway: booking status changes, job offers/expiry, payout
  updates, in-app fallback rows for every pushed event.

### Phase 3 — Customer app
- Providers (Query, auth/secure store, API client), design system (Button, Input, Card,
  Screen, Sheet, Badge, EmptyState, ErrorState, Skeletons, StatusTimeline).
- Splash/onboarding/OTP/profile setup, home, vehicle management, catalogue, guided booking
  flow (vehicle → service → add-ons → address → slot → review → coupon → payment → confirm),
  tracking, history/rebooking/invoices, profile sections, support.

### Phase 4 — Partner app
- Registration + document upload + approval state, dashboard (online toggle, today's jobs,
  offers, earnings), job lifecycle with navigation/contact/photos/issues, earnings and
  payouts, training checklist, notifications, support.

### Phase 5 — Admin dashboard
- Login, overview metrics, tables with search/filter/sort/paginate/detail/CSV, bookings +
  assignment, customers, partners + verification, catalogue/pricing/areas/availability,
  coupons, subscriptions, payments/refunds, earnings/payouts, reviews, tickets,
  notifications, reports, admin users/roles, audit logs, business settings.

### Phase 6 — Quality
- Unit tests (pricing, coupons, eligibility, commission, transitions, subscription usage).
- Integration tests (auth/RBAC, booking creation, slot capacity, assignment, job status,
  payment verification, duplicate webhooks, refunds, ledger).
- E2E: customer books → admin assigns → partner accepts/advances → customer sees status →
  financial records correct, plus failure/unauthorized/duplicate/invalid-transition cases.
- Lint + typecheck green across all workspaces.

### Phase 7 — Documentation & polish
- `README.md`, environment setup, local dev, Expo run instructions (Android/iOS), backend,
  admin, testing, production/deployment, integrations, troubleshooting.
- Accessibility pass, loading/empty/error states audited on every screen.

## 7. Environment & local setup

- Node 24 / npm 11, PostgreSQL 18 running locally on `localhost:5432` (trust auth).
- `DATABASE_URL=postgresql://postgres@localhost:5432/Autowra_dev?schema=public`.
- Copy `.env.example` → `.env`. Only placeholders ship in the repository.
- Dev-only shortcuts: `DEV_AUTH_ENABLED=true` + `DEV_AUTH_OTP`, `PAYMENT_PROVIDER=mock`,
  `SMS_PROVIDER=console`, `STORAGE_DRIVER=local`. All are refused when
  `NODE_ENV=production`.

## 8. Commands

```
npm install                # install + link workspaces
npm run build:packages     # compile packages/*
npm run db:migrate         # prisma migrate dev
npm run db:seed            # seed development data
npm run backend:dev        # NestJS on :4000
npm run customer:start     # Expo dev server (customer)
npm run partner:start      # Expo dev server (partner)
npm run admin:dev          # Next.js on :3000
npm test                   # unit + integration
npm run test:e2e           # end-to-end
npm run typecheck          # all workspaces
npm run lint               # all workspaces
```

## 9. Known constraints & decisions

| Decision | Reason |
| --- | --- |
| npm workspaces instead of pnpm | pnpm is not installed on the target machine |
| Local PostgreSQL instead of Docker | Docker is not installed; PostgreSQL 18 runs as a Windows service |
| Prisma 6.19.3 with `prisma-client-js` | Prisma 7's `prisma-client` generator emits ESM TypeScript, which is incompatible with the CommonJS NestJS build |
| `as const` enums instead of TS `enum` | One source of truth usable by Node, Metro and Next without transpilation tricks |
| Mock payment provider in dev | Razorpay credentials are not available; the mock is labelled and never enabled in production |

## 10. Status legend

✅ done · 🔄 in progress · ⬜ not started
