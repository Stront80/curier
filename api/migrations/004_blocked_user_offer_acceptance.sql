BEGIN;

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
  v_latest_offer_id uuid;
  v_active_participants integer;
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

  IF p_customer_id <> v_order.customer_id
     AND p_customer_id <> v_offer.courier_id THEN
    RAISE EXCEPTION 'Only order participants can accept offers';
  END IF;

  -- Serialize this check with account-blocking updates. Lock both profiles
  -- in a stable order to reduce deadlock risk between concurrent acceptances.
  PERFORM p.id
  FROM public.profiles p
  WHERE p.id IN (v_order.customer_id, v_offer.courier_id)
  ORDER BY p.id
  FOR UPDATE;

  SELECT count(*) INTO v_active_participants
  FROM public.profiles
  WHERE id IN (v_order.customer_id, v_offer.courier_id)
    AND is_blocked = false;

  IF v_active_participants <> 2 THEN
    RAISE EXCEPTION 'Offer participant unavailable';
  END IF;

  IF v_order.status NOT IN ('open', 'negotiating')
     OR v_order.courier_id IS NOT NULL THEN
    RAISE EXCEPTION 'Order is no longer available';
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'Offer is no longer available';
  END IF;

  IF (p_customer_id = v_order.customer_id
      AND v_offer.proposer_id <> v_offer.courier_id)
     OR (p_customer_id = v_offer.courier_id
      AND v_offer.proposer_id <> v_order.customer_id) THEN
    RAISE EXCEPTION 'Offer was not made by the other participant';
  END IF;

  SELECT o.id INTO v_latest_offer_id
  FROM public.offers o
  WHERE o.order_id = v_order.id
    AND o.courier_id = v_offer.courier_id
    AND o.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.offers child
      WHERE child.parent_offer_id = o.id
    )
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT 1;

  IF v_latest_offer_id IS DISTINCT FROM v_offer.id THEN
    RAISE EXCEPTION 'Offer is not the latest offer';
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
    AND status = 'pending';

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
