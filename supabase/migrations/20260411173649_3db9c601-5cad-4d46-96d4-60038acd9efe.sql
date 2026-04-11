
ALTER TABLE public.unified_props ADD COLUMN IF NOT EXISTS market_key text;

CREATE UNIQUE INDEX IF NOT EXISTS unified_props_market_key_unique 
  ON public.unified_props (market_key) 
  WHERE market_key IS NOT NULL;
