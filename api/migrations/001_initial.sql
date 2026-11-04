BEGIN;

CREATE TYPE public.order_status AS ENUM (
  'open', 'negotiating', 'agreed', 'picked_up',
  'in_transit', 'delivered', 'cancelled', 'expired', 'dispute'
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint UNIQUE NOT NULL,
  username text,
  first_name text NOT NULL DEFAULT '',
  last_name text,
  language text NOT NULL DEFAULT 'ru'
    CHECK (language IN ('ru', 'en')),
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  title text NOT NULL,
  pickup_address text NOT NULL,
  dropoff_address text NOT NULL,
  description text NOT NULL,
  initial_price numeric(12,2)
    CHECK (initial_price IS NULL OR initial_price >= 0),
  agreed_price numeric(12,2)
    CHECK (agreed_price IS NULL OR agreed_price >= 0),
  courier_id uuid REFERENCES public.profiles(id),
  status public.order_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  early_access_until timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  courier_id uuid NOT NULL REFERENCES public.profiles(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  comment text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'countered', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.star_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('support', 'early_access')),
  stars integer NOT NULL CHECK (stars > 0),
  telegram_charge_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'refunded', 'failed')),
  access_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX orders_status_created_idx
  ON public.orders(status, created_at DESC);

CREATE INDEX offers_order_created_idx
  ON public.offers(order_id, created_at DESC);

CREATE INDEX payments_telegram_idx
  ON public.star_payments(telegram_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.accept_offer_transaction(
  p_offer_id uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer public.offers%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_offer
  FROM public.offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = v_offer.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'Only the customer can accept offers';
  END IF;

  IF v_order.status NOT IN ('open', 'negotiating')
     OR v_order.courier_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order is no longer available';
  END IF;

  IF v_offer.status NOT IN ('pending', 'countered') THEN
    RAISE EXCEPTION 'Offer is no longer available';
  END IF;

  UPDATE public.orders
  SET status = 'agreed',
      courier_id = v_offer.courier_id,
      agreed_price = v_offer.amount,
      updated_at = now()
  WHERE id = v_order.id;

  UPDATE public.offers
  SET status = CASE
    WHEN id = p_offer_id THEN 'accepted'
    ELSE 'rejected'
  END
  WHERE order_id = v_order.id
    AND status IN ('pending', 'countered');

  INSERT INTO public.order_events (
    order_id, actor_id, event_type, payload
  )
  VALUES (
    v_order.id,
    p_customer_id,
    'offer_accepted',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'courier_id', v_offer.courier_id,
      'amount', v_offer.amount
    )
  );

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'courier_id', v_offer.courier_id,
    'agreed_price', v_offer.amount,
    'status', 'agreed'
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.accept_offer_transaction(uuid, uuid)
  FROM PUBLIC;

COMMIT;
