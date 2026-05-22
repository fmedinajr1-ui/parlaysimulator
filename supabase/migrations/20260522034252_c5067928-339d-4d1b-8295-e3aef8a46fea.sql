
CREATE TABLE IF NOT EXISTS public.cross_sport_leg_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id uuid NOT NULL,
  parlay_date date NOT NULL,
  strategy_name text NOT NULL,
  sport text,
  market_type text,
  prop_type text,
  side text,
  line numeric,
  player_name text,
  team text,
  tier text,
  safety_score numeric,
  l10_hit_rate numeric,
  result text NOT NULL CHECK (result IN ('hit','miss','void')),
  actual_value numeric,
  actual_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csl_feedback_date ON public.cross_sport_leg_feedback (parlay_date DESC);
CREATE INDEX IF NOT EXISTS idx_csl_feedback_prop ON public.cross_sport_leg_feedback (sport, prop_type, side, result);

ALTER TABLE public.cross_sport_leg_feedback ENABLE ROW LEVEL SECURITY;

-- No client access — service role bypasses RLS.
CREATE POLICY "deny_all_select_csl_feedback"
  ON public.cross_sport_leg_feedback FOR SELECT USING (false);

SELECT cron.schedule(
  'cross-sport-parlay-settler-hourly',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/cross-sport-parlay-settler',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
