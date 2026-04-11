
-- Truncate pp_snapshot (massively bloated with duplicates)
TRUNCATE TABLE public.pp_snapshot;

-- Add unique constraint
ALTER TABLE public.pp_snapshot ADD CONSTRAINT pp_snapshot_market_key_unique UNIQUE (market_key);

-- Deduplicate unified_props
DELETE FROM public.unified_props a USING public.unified_props b
WHERE a.market_key IS NOT NULL AND a.market_key = b.market_key AND a.id < b.id;

-- Partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS unified_props_market_key_unique ON public.unified_props (market_key) WHERE market_key IS NOT NULL;
