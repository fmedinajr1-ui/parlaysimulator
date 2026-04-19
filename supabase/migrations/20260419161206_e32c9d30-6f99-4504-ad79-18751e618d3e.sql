-- Alert type accuracy cache for fast lookup by dispatcher
CREATE TABLE IF NOT EXISTS public.alert_type_accuracy_cache (
  alert_type TEXT PRIMARY KEY,
  l7_hit_rate NUMERIC,
  l30_hit_rate NUMERIC,
  sample_size_l7 INTEGER DEFAULT 0,
  sample_size_l30 INTEGER DEFAULT 0,
  trend TEXT DEFAULT 'neutral' CHECK (trend IN ('hot','neutral','cold','ice_cold')),
  stake_multiplier NUMERIC DEFAULT 1.0,
  recommendation TEXT DEFAULT 'standard' CHECK (recommendation IN ('size_up','standard','light','skip')),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_type_accuracy_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on alert_type_accuracy_cache"
  ON public.alert_type_accuracy_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_alert_accuracy_updated ON public.alert_type_accuracy_cache(last_updated DESC);