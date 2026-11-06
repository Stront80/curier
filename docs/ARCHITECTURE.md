# Architecture

## Request flow

Telegram Mini App (React/Vite) → HTTPS frontend host / Apache → /api/ reverse proxy → Express API → PostgreSQL.

Telegram provides signed Mini App initData. The API verifies it server-side and issues a JWT used for authenticated API requests. The frontend must not be treated as an authority for user identity or permissions.

## Components

- src/: UI and client-side API interactions.
- api/src/server.ts: Express routes, authorization checks and order/offer workflows.
- api/src/telegram-auth.ts: Telegram authentication validation.
- api/migrations/: PostgreSQL schema and function changes.
- PostgreSQL: profiles, orders, offers, events and prepared payment records.

## Current order/offer flow

1. A customer creates an order.
2. The database default sets early_access_until to ten minutes after creation.
3. Eligible couriers can see open orders after that delay.
4. A courier creates an offer.
5. Either party may counter a pending offer from the other party; the prior offer becomes countered and the new offer links to it through parent_offer_id.
6. A valid pending offer can be accepted through the database transaction function. The order becomes agreed and competing active offers are resolved.

The ten-minute visibility delay is not a paid subscription. Telegram Stars payments and activation of 24-hour paid early access are not implemented.

## Security boundaries

- Verify Telegram initData on the server; do not trust initDataUnsafe as authentication.
- Verify the authenticated user against the customer/courier identity involved in each resource.
- Keep the Telegram bot token, JWT secret and database credentials server-side.
- Enforce order and offer state rules in the API/database, not only in the UI.
- Keep acceptance atomic in PostgreSQL to avoid two parties accepting conflicting offers.
- Restrict execution rights on privileged database functions to the API role.
- Admin/superuser permissions are not yet a complete role-based authorization system; do not expose admin operations until explicit authorization and audit logging exist.

## Operational model

The deployed API runs as a systemd service and listens on localhost; Apache proxies public /api/ traffic to it. Production deployment should occur only after build, tests, backup and health checks. Avoid restarting or deploying while tests are failing.

## Known gaps

- Automated API tests and CI checks.
- A fully specified order lifecycle, cancellation and dispute handling.
- Explicit role/permission model including superuser administration.
- Notifications and delivery completion flow.
- Courier ratings and review moderation.
- Telegram Stars invoice, pre-checkout, successful-payment, idempotency, expiry and refund handling.
