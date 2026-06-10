CREATE TABLE IF NOT EXISTS public.live_next_play_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  player_name text NOT NULL,
  prop_type text NOT NULL,
  prop_label text NOT NULL,
  line numeric NOT NULL,
  side text NOT NULL CHECK (side IN ('Over','Under')),
  book text,
  american_price integer,
  prob_next_play numeric NOT NULL,
  edge_pct numeric,
  rationale text,
  state_context jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 seconds')
);

CREATE INDEX IF NOT EXISTS live_next_play_predictions_event_idx
  ON public.live_next_play_predictions (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS live_next_play_predictions_expires_idx
  ON public.live_next_play_predictions (expires_at);

GRANT SELECT ON public.live_next_play_predictions TO anon, authenticated;
GRANT ALL ON public.live_next_play_predictions TO service_role;

ALTER TABLE public.live_next_play_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read live predictions"
  ON public.live_next_play_predictions
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage live predictions"
  ON public.live_next_play_predictions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_next_play_predictions;