# Delivery Market — Telegram Mini App

Telegram Mini App for a delivery marketplace where customers and couriers negotiate delivery prices.

## Current architecture

- Frontend: React, TypeScript and Vite (src/).
- Backend API: Express + TypeScript (api/src/), compiled to api/dist/.
- Database: PostgreSQL. SQL migrations are in api/migrations/.
- Authentication: Telegram Mini App initData is verified server-side; the API issues a JWT for subsequent requests.
- Hosting: frontend over HTTPS; Apache proxies /api/ requests to the Node API.
- Telegram Stars: planned for a later release. Real invoices, payment confirmation, refunds and paid access activation are not implemented in the current version.

The Supabase setup described in older versions of this README is not the deployed architecture. Do not use Supabase CLI instructions for production.

## Current functionality

- Telegram-based authentication.
- Customer order creation.
- A 10-minute initial visibility delay before eligible orders are visible to couriers.
- Courier offers and two-way counteroffers.
- Acceptance of a pending offer and transition of the order to the agreed state.
- Offer history and order events used by the UI.

See docs/ARCHITECTURE.md and docs/ROADMAP.md for details and planned work.

## Repository structure

- src/ — frontend application.
- api/src/ — Express API and Telegram authentication.
- api/migrations/ — PostgreSQL migrations.
- api/package.json — API scripts and dependencies.
- prototype-preview.html — static visual prototype.

## Local development

Requirements: Node.js and npm.

Frontend:
```bash
npm install
npm run dev
```

API:
```bash
cd api
npm install
npm run dev
```

Configure API environment variables in a server-side .env file. Keep the Telegram bot token and database credentials out of frontend variables and source control. Never paste secrets into issues, logs or chat.

## Build and checks

From the repository root:
```bash
npm run build
```

For API checks:
```bash
cd api
npm run build
npm test
```

The API test script is being established; do not treat a successful build alone as proof that business flows or permissions are correct. Run production smoke checks and review the release checklist before deploying.

## Production safety

- Apply database migrations deliberately and keep a verified backup before schema changes.
- Build and test before restarting the API or publishing frontend assets.
- Keep secrets in server-side environment files with restricted permissions.
- Verify authentication, authorization, rate limiting, error handling and order state transitions.
- Payment records/schema are preparatory only. Do not claim that Stars payments or 24-hour paid access work until the full server-side payment lifecycle is implemented and tested.
- Add legal, privacy, prohibited-items and moderation policies before public launch.

## License

Not specified yet.
