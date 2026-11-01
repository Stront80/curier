# Delivery Market — Telegram Mini App

Telegram Mini App for a delivery marketplace where customers and couriers negotiate delivery prices.

## Stack
- React + TypeScript + Vite
- Supabase PostgreSQL and Edge Functions
- Telegram Mini Apps / Bot API
- Telegram Stars planned for voluntary support and 24-hour courier early access

## Project status
Starter implementation. It is **not production-ready**. The UI and database/functions are scaffolding and must be reviewed and tested before handling real users or payments.

## Repository structure
- `src/` — frontend application
- `supabase/migrations/` — database schema migrations
- `supabase/functions/` — server-side Edge Functions
- `prototype-preview.html` — static visual prototype

## Run locally
Requirements: Node.js 20+ and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Configure `.env.local` with your Supabase project URL and anon key. Never put the Supabase service-role key or Telegram bot token in frontend environment variables.

## Supabase setup
1. Install the Supabase CLI and authenticate.
2. Link this repository to your Supabase project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
3. Apply migrations:
   ```bash
   supabase db push
   ```
4. Add the Telegram bot token as a server secret:
   ```bash
   supabase secrets set TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
   ```
5. Deploy the Edge Functions:
   ```bash
   supabase functions deploy telegram-auth
   supabase functions deploy list-orders
   supabase functions deploy create-order
   supabase functions deploy place-offer
   supabase functions deploy accept-offer
   ```

## Telegram setup
1. Configure the Mini App URL for your bot via BotFather.
2. Deploy the frontend to an HTTPS host.
3. Open the Mini App from Telegram so signed `initData` is available.
4. Validate Telegram `initData` on the server. Do not trust `initDataUnsafe` for authentication.

## Before public launch
- Complete and test Telegram Stars invoice creation, pre-checkout, successful-payment handling, idempotency and refunds.
- Configure bot webhook and notifications.
- Finish counteroffers, order status transitions, cancellation, disputes and moderation.
- Audit RLS policies and Edge Functions; add rate limiting and monitoring.
- Add terms, privacy notice and prohibited-items policy.
- Do not collect passport scans by default. Review Russian self-employed receipt guidance with a qualified lawyer.
- Test early access: paid couriers see eligible orders for the first 10 minutes; access lasts 24 hours after activation.
- Run `npm run build` and automated security/flow tests before release.

## Architecture
Telegram Mini App → Supabase Edge Functions → PostgreSQL. Telegram Bot API handles notifications and the Stars payment lifecycle. Keep secrets server-side.

## License
Not specified yet.
