<p align="center">
  <img src="./apps/admin/public/Autowra.png" alt="Autowra Logo" width="160" height="160" style="border-radius: 50%;" />
</p>

<h1 align="center">Autowra</h1>

<p align="center">
  <strong>Production-Ready On-Demand Vehicle Wash & Doorstep Detailing Marketplace</strong>
</p>

<p align="center">
  <a href="https://github.com/codedbyamankanojiya"><img src="https://img.shields.io/badge/Author-codedbyamankanojiya-black?style=for-the-badge&logo=github" alt="Author"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20.19-green?style=for-the-badge&logo=node.js" alt="Node Version">
  <img src="https://img.shields.io/badge/React%20Native-0.88-61DAFB?style=for-the-badge&logo=react" alt="React Native">
  <img src="https://img.shields.io/badge/Expo-SDK%2058-000020?style=for-the-badge&logo=expo" alt="Expo">
  <img src="https://img.shields.io/badge/NestJS-12-E0234E?style=for-the-badge&logo=nestjs" alt="NestJS">
  <img src="https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/Prisma-6.19-2D3748?style=for-the-badge&logo=prisma" alt="Prisma">
  <img src="https://img.shields.io/badge/PostgreSQL-18-4169E1?style=for-the-badge&logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/TypeScript-Strict-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
</p>

---

## 📌 Overview

**Autowra** is a modern, full-stack marketplace application engineered for on-demand doorstep car and bike care. Inspired by the convenience of app-based auto detailing, Autowra enables customers to book specialized vehicle washing at their residence, office, or apartment parking, while certified service partners receive, execute, and document jobs in real time with photo evidence and digital checklists.

The system is built as a unified **npm workspace monorepo** with shared validation contracts, unified data models, and a centralized NestJS backend that serves as the single source of truth across all clients.

---

## 🏗️ System Architecture

```
                               ┌────────────────────────────────┐
                               │   Autowra PostgreSQL Database  │
                               │   (Prisma ORM + Migrations)    │
                               └───────────────▲────────────────┘
                                               │
                               ┌───────────────┴────────────────┐
                               │     Shared NestJS API Engine   │
                               │  Auth · Pricing · Bookings ·   │
                               │   Ledgers · WebSockets · S3    │
                               └─────────▲──────▲──────▲────────┘
                                         │      │      │
               ┌─────────────────────────┘      │      └─────────────────────────┐
               │                                │                                │
┌──────────────┴───────────────┐ ┌──────────────┴───────────────┐ ┌──────────────┴───────────────┐
│     Customer Mobile App      │ │      Partner Mobile App      │ │     Admin Web Dashboard     │
│   (Expo / React Native)      │ │    (Expo / React Native)     │ │     (Next.js App Router)    │
│  Browse · Book · Pay · Track │ │ Accept · Navigate · Job KYC  │ │ Operations · Dispatch · KYC │
└──────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘
```

### Monorepo Structure

```
autowra/
├── apps/
│   ├── customer/            # Customer mobile app (Expo SDK 58, Expo Router, React Native)
│   ├── partner/             # Washing professional mobile app (Expo SDK 58, GPS, Camera)
│   └── admin/               # Web-based operations & admin dashboard (Next.js 16, Tailwind CSS)
│
├── packages/
│   ├── config/              # Central brand tokens, styling variables & business contact info
│   ├── shared-types/        # Domain enums, DTOs, integer money helpers, presentation maps
│   ├── validation/          # Shared Zod validation schemas (enforced in API and frontends)
│   └── api-client/          # Strongly-typed HTTP fetch client with automated 401 token refresh
│
├── backend/
│   ├── prisma/              # Prisma schema (30+ models), migrations & development seeders
│   └── src/                 # NestJS application (modular controllers, guards, and services)
│
├── BUILD_PLAN.md            # Living roadmap and execution milestone tracker
├── .env.example             # Comprehensive environment variable template
└── package.json             # Root workspace orchestration
```

---

## 🚀 Key Features

### 1. Customer Mobile Experience (`apps/customer`)
- **Zero-Friction Authentication:** Phone-based OTP verification with automatic rate-limiting and dev-mode login shortcuts.
- **Dynamic Vehicle Management:** Support for multiple cars and two-wheelers categorized by size (Hatchback, Sedan, SUV, Cruiser, etc.).
- **Smart Guided Booking Flow:** Vehicle selection → Service catalog & add-ons → Geo-coded address selection → Live capacity slot picker → Order review with server-calculated breakdown.
- **Secure Payment Pipeline:** Integrated Razorpay checkout supporting UPI, Cards, and NetBanking, plus an offline/mock payment adapter for local dev.
- **Live Status Tracking:** Real-time job lifecycle tracking with assigned partner details, arrival timestamps, before/after evidence photos, and instant invoice downloads.

### 2. Partner Mobile Companion (`apps/partner`)
- **Digital Onboarding & KYC:** Document upload (Aadhaar, Driving License, Bank Details) to private storage for operational verification.
- **Real-Time Job Dispatching:** Live job alerts with sound notifications, payout previews, and acceptance TTL countdowns.
- **Field Workflow & Navigation:** Step-by-step job lifecycle (`ASSIGNED` → `ACCEPTED` → `TRAVELLING` → `ARRIVED` → `IN_PROGRESS` → `COMPLETED`).
- **Proof of Service:** Mandatory camera captures for before-and-after wash verification.
- **Earnings & Ledger:** Transparent payout dashboard tracking gross revenue, platform commissions, tips, and settlement schedules.

### 3. Centralized Operations Dashboard (`apps/admin`)
- **Comprehensive Command Center:** High-level operational metrics (revenue, active bookings, partner utilization).
- **Dispatch & Assignment:** Automated candidate ranking with manual admin assignment override.
- **Service & Dynamic Pricing Catalog:** Manage vehicle tiers, category pricing, add-ons, and seasonal promo coupons.
- **KYC & Partner Compliance:** Secure inspection and approval workflow for washing professionals.
- **Financial Settlements:** Automated commission ledger, payout approvals, and refund authorizations.

---

## 🛡️ Core Engineering Standards

1. **Integer Minor Units (Paise) for Money:** All currency amounts across database columns, DTOs, and calculations are stored as integers (1 INR = 100 paise) to prevent IEEE-754 floating-point inaccuracies.
2. **Server-Authoritative Computations:** The server never trusts client-submitted pricing totals, discounts, or partner payouts; every quote is recalculated against active database rules.
3. **Strict Separation of Booking vs. Payment Status:** A booking's state machine (`CONFIRMED`, `IN_PROGRESS`, etc.) operates independently of payment settlement (`AUTHORIZED`, `CAPTURED`, `REFUNDED`).
4. **Idempotency Everywhere:** Database-level unique constraints and idempotency keys guard every critical operation (booking creation, payment capture, slot locking) against double-submits.
5. **No Bundled Secrets:** Only non-sensitive variables prefixed with `EXPO_PUBLIC_` are exposed to mobile clients. Database credentials and private keys remain strictly server-side.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Monorepo** | npm Workspaces, TypeScript 5.9, ESLint 9 |
| **Mobile Frontends** | React Native 0.88, Expo SDK 58, Expo Router, React Native Reanimated, Zustand, TanStack Query |
| **Web Admin** | Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide Icons |
| **Backend API** | NestJS 12, Node.js, Express, Socket.IO (WebSockets), Helmet, Throttler |
| **Database & ORM** | PostgreSQL 18, Prisma ORM 6.19 |
| **Validation & State** | Zod 4, TanStack Query 5 |
| **Payments** | Razorpay SDK + Zero-Config Simulated Mock Provider |
| **Storage & Media** | AWS S3 SDK (Local storage driver for local dev) |

---

## 📋 Prerequisites

Before setting up the project, ensure you have the following installed:
- **Node.js**: `v20.19.0` or higher (`v24.x` recommended)
- **npm**: `v10.x` or higher
- **PostgreSQL**: `v16` or higher (running locally on port `5432`)
- **Expo CLI & Expo Go**: Optional for physical device testing (`npx expo start`)

---

## ⚡ Quick Start & Setup Guide

### 1. Clone the Repository

```bash
git clone https://github.com/codedbyamankanojiya/Autowra.git
cd Autowra
```

### 2. Install Dependencies

Install all root dependencies and link all workspace packages:

```bash
npm install
```

### 3. Configure Environment Variables

Copy the provided `.env.example` to `.env`:

```bash
cp .env.example .env
```

The default `.env` is pre-configured for out-of-the-box local development using:
- **Mock Payment Provider:** Simulates successful payments without requiring live Razorpay API keys.
- **Console SMS Provider:** Prints OTPs directly to your backend terminal log.
- **Local Storage Driver:** Saves uploaded photos and KYC documents to `backend/storage/`.
- **Dev Auth Mode:** Allows instant login with fixed OTP `123456`.

*(Optional)* If you have live PostgreSQL running, verify your database URL in `.env`:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/autowra_dev?schema=public"
```

### 4. Build Shared Workspace Packages

Compile `shared-types`, `validation`, `config`, and `api-client`:

```bash
npm run build:packages
```

### 5. Setup the Database

Generate Prisma client, apply database migrations, and seed initial service packages, areas, and test accounts:

```bash
# Push schema & run migrations
npm run db:migrate

# Seed demo catalog, pricing, test partners & admin account
npm run db:seed
```

---

## 🖥️ Running the Applications

Each component can be started independently or in parallel terminals:

### 1. Start the Shared Backend API (Port 4000)

```bash
npm run backend:dev
```
- **API URL:** `http://localhost:4000/api/v1`
- **Swagger Documentation:** `http://localhost:4000/api/docs`

### 2. Start the Customer Mobile App (Expo)

```bash
npm run customer:start
```
- Press `a` to open in Android Emulator, `i` for iOS Simulator, or scan the QR code with **Expo Go**.

### 3. Start the Partner Mobile App (Expo)

```bash
npm run partner:start
```

### 4. Start the Admin Web Dashboard (Port 3000)

```bash
npm run admin:dev
```
- Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 📦 Available Scripts Reference

| Command | Description |
| :--- | :--- |
| `npm run build:packages` | Compiles all four shared packages in `packages/*` |
| `npm run typecheck:packages` | Typechecks all shared library packages |
| `npm run backend:dev` | Launches the NestJS API with hot reload on `:4000` |
| `npm run backend:build` | Compiles the production NestJS bundle |
| `npm run db:migrate` | Runs Prisma migrations against PostgreSQL |
| `npm run db:seed` | Populates database with categories, services, slots & dev users |
| `npm run customer:start` | Launches Expo Metro bundler for the customer app |
| `npm run partner:start` | Launches Expo Metro bundler for the partner app |
| `npm run admin:dev` | Starts the Next.js admin dashboard server on `:3000` |
| `npm run typecheck` | Runs TypeScript verification across all 7 workspace packages |
| `npm run lint` | Runs ESLint across all projects |
| `npm test` | Executes unit tests in the backend workspace |

---

## 🔑 Default Seed Accounts (Development)

When `npm run db:seed` is executed, the following testing accounts are provisioned:

| Role | Identifier | Credential / OTP | Purpose |
| :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@autowra.example` | `Admin@123456` | Full access to the Next.js admin dashboard |
| **Customer** | `+91 9876543210` | OTP: `123456` | Booking services, managing vehicles & addresses |
| **Partner 1** | `+91 9876500001` | OTP: `123456` | Active partner (Koramangala & Indiranagar) |
| **Partner 2** | `+91 9876500002` | OTP: `123456` | Active partner (HSR Layout) |

---

## 👨‍💻 Author

**Aman Kanojiya**
- GitHub: [@codedbyamankanojiya](https://github.com/codedbyamankanojiya)

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE).
