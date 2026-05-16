
ALTER TABLE public.unified_props
  ADD COLUMN IF NOT EXISTS market_type text NOT NULL DEFAULT 'player';

CREATE INDEX IF NOT EXISTS idx_unified_props_market_type_sport_time
  ON public.unified_props (sport, market_type, commence_time);
