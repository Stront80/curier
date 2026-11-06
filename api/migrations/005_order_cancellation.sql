BEGIN;

CREATE TABLE public.order_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'declined')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_by uuid REFERENCES public.profiles(id),
  responded_at timestamptz,
  CHECK (
    (status = 'pending' AND responded_by IS NULL AND responded_at IS NULL)
    OR
    (status IN ('confirmed', 'declined')
      AND responded_by IS NOT NULL AND responded_at IS NOT NULL)
  ),
  CHECK (responded_by IS NULL OR responded_by <> requested_by)
);

CREATE UNIQUE INDEX order_cancellation_one_pending_idx
  ON public.order_cancellation_requests(order_id)
  WHERE status = 'pending';

CREATE INDEX order_cancellation_order_history_idx
  ON public.order_cancellation_requests(order_id, requested_at DESC);

REVOKE ALL ON TABLE public.order_cancellation_requests FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.order_cancellation_requests TO curier_app;

COMMIT;
