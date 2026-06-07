
CREATE TABLE public.mlb_fair_price_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  event_type text NOT NULL,
  feed_ts bigint NOT NULL,
  event_time timestamptz NOT NULL,
  pre_state jsonb NOT NULL,
  post_state jsonb NOT NULL,
  wp_pre double precision,
  wp_post double precision,
  delta_wp double precision,
  market text NOT NULL DEFAULT 'LIVE_ML',
  book_id text,
  book_implied double precision,
  book_implied_devig double precision,
  book_last_move_ts bigint,
  edge double precision,
  ev_pct double precision,
  ttl_ms integer,
  gate_decision text NOT NULL,
  skip_reason text,
  severity text NOT NULL DEFAULT 'WARN',
  telegram_sent boolean NOT NULL DEFAULT false,
  telegram_admin_only boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mlb_fp_game ON public.mlb_fair_price_events (game_id, created_at DESC);
CREATE INDEX idx_mlb_fp_decision ON public.mlb_fair_price_events (gate_decision, created_at DESC);

GRANT SELECT ON public.mlb_fair_price_events TO authenticated;
GRANT ALL ON public.mlb_fair_price_events TO service_role;

ALTER TABLE public.mlb_fair_price_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read mlb fair price events"
ON public.mlb_fair_price_events
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role manages mlb fair price events"
ON public.mlb_fair_price_events
FOR ALL
TO service_role
USING (true) WITH CHECK (true);
