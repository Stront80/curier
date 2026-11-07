# Telegram chat bot — Phase 1

The bot runs as a separate Node process beside the Express API and Mini App. It uses the same PostgreSQL database and existing profiles, orders, order_events and star_payments tables.

## Implemented in this branch

- /start, /menu, /help, /orders, /myorders, /neworder and /donate.
- Persistent multi-step order creation in Telegram private chat. Required: city, pickup date/time text, metro station or district, courier reward and three-letter currency code.
- Public order cards omit customer contact data.
- Atomic direct claim using a PostgreSQL transaction and row locks. Only one courier can claim an order.
- Customer and courier notifications after assignment.
- Contact reveal only to the courier assigned to that order. It is free during the test phase.
- Voluntary Ozon Bank / SBP donations: the bot sends the supplied QR image and payment link. Donations are optional and do not gate any feature.

## Not implemented yet

- Automated payment verification and payment-gated features. The current Ozon Bank link/QR is a general receiving link and does not provide per-donation transaction callbacks to the bot.
- Paid order publication and paid contact reveal (later roadmap phases).
- Full admin/moderation workflows and cancellation from bot chat.
- Notifications for every Mini App negotiation event.

## Deployment

1. Review and apply api/migrations/006_telegram_bot_phase1.sql after a verified backup.
2. Build: cd api && npm ci && npm run build.
3. Configure TELEGRAM_BOT_TOKEN, DATABASE_URL, RUN_TELEGRAM_BOT=true, DONATION_PAYMENT_URL and DONATION_QR_FILE in the bot process environment. Place the supplied Ozon Bank QR image at the path configured by DONATION_QR_FILE (JPEG). Use the same PostgreSQL database as the API. Never expose the bot token to frontend variables.
4. Run node dist/telegram-bot.js as a dedicated systemd service. Keep exactly one active long-polling instance per token.
5. Test with two Telegram accounts: create an order, check that public cards contain no contacts, claim it from another account, verify both notifications and verify only the assigned courier can view contacts.
6. Test the donation button: verify the QR image and Ozon Bank link are delivered. Confirm that all bot functions remain available without donating.

The donation QR and link are configured by the operator. Donations are voluntary and do not unlock or restrict any bot feature. The bot is designed for private chats. The API process and bot process are separate services.

## Decisions still required

- A business acquiring/API integration is required before automated payment confirmation or paid features can be introduced.
- Prices for future order publication and contact unlock.
- Whether contact access should be allowed only after assignment (current behavior) or at another approved point.
- Exact contact fields; the current implementation provides a Telegram profile link, not a phone number.
