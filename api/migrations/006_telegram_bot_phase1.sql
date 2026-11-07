BEGIN;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS pickup_at_text text,
  ADD COLUMN IF NOT EXISTS metro_or_district text,
  ADD COLUMN IF NOT EXISTS reward_amount numeric(12,2) CHECK (reward_amount IS NULL OR reward_amount > 0),
  ADD COLUMN IF NOT EXISTS reward_currency varchar(3);
ALTER TABLE public.star_payments
  ADD COLUMN IF NOT EXISTS payment_payload text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS star_payments_payload_uidx
  ON public.star_payments(payment_payload) WHERE payment_payload IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.bot_sessions (
  telegram_id bigint PRIMARY KEY, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bot_sessions_updated_idx ON public.bot_sessions(updated_at);
CREATE TABLE IF NOT EXISTS public.bot_processed_updates (
  update_id bigint PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
