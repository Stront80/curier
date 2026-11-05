BEGIN;

ALTER TABLE public.offers
  ADD COLUMN proposer_id uuid REFERENCES public.profiles(id),
  ADD COLUMN parent_offer_id uuid REFERENCES public.offers(id);

UPDATE public.offers o
SET proposer_id = o.courier_id
WHERE o.proposer_id IS NULL;

ALTER TABLE public.offers
  ALTER COLUMN proposer_id SET NOT NULL;

CREATE INDEX offers_parent_offer_idx
  ON public.offers(parent_offer_id)
  WHERE parent_offer_id IS NOT NULL;

CREATE INDEX offers_active_order_idx
  ON public.offers(order_id, status)
  WHERE status IN ('pending', 'countered');

COMMIT;
