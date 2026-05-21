-- Extend whale_picks for Smart Whale Engine v2
ALTER TABLE public.whale_picks
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS game_description TEXT,
  ADD COLUMN IF NOT EXISTS prop_type TEXT,
  ADD COLUMN IF NOT EXISTS side TEXT,
  ADD COLUMN IF NOT EXISTS current_line NUMERIC,
  ADD COLUMN IF NOT EXISTS opening_line NUMERIC,
  ADD COLUMN IF NOT EXISTS current_over_price NUMERIC,
  ADD COLUMN IF NOT EXISTS current_under_price NUMERIC,
  ADD COLUMN IF NOT EXISTS bookmaker TEXT DEFAULT 'fanduel',
  ADD COLUMN IF NOT EXISTS whale_score INTEGER,
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS sub_scores JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS why_short_text TEXT,
  ADD COLUMN IF NOT EXISTS signal_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS commence_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS was_correct BOOLEAN,
  ADD COLUMN IF NOT EXISTS actual_outcome TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Allow nullable on legacy required cols so v2 inserts don't trip them
ALTER TABLE public.whale_picks ALTER COLUMN stat_type DROP NOT NULL;
ALTER TABLE public.whale_picks ALTER COLUMN pick_side DROP NOT NULL;
ALTER TABLE public.whale_picks ALTER COLUMN pp_line DROP NOT NULL;
ALTER TABLE public.whale_picks ALTER COLUMN confidence DROP NOT NULL;
ALTER TABLE public.whale_picks ALTER COLUMN sharp_score DROP NOT NULL;
ALTER TABLE public.whale_picks ALTER COLUMN signal_type DROP NOT NULL;

-- Validation triggers (avoid CHECK constraints per project convention)
CREATE OR REPLACE FUNCTION public.whale_picks_validate_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tier IS NOT NULL AND NEW.tier NOT IN ('S','A','B') THEN
    RAISE EXCEPTION 'whale_picks.tier must be S, A, or B (got %)', NEW.tier;
  END IF;
  IF NEW.side IS NOT NULL AND NEW.side NOT IN ('Over','Under') THEN
    RAISE EXCEPTION 'whale_picks.side must be Over or Under (got %)', NEW.side;
  END IF;
  IF NEW.whale_score IS NOT NULL AND (NEW.whale_score < 0 OR NEW.whale_score > 100) THEN
    RAISE EXCEPTION 'whale_picks.whale_score out of range (got %)', NEW.whale_score;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whale_picks_validate_v2 ON public.whale_picks;
CREATE TRIGGER trg_whale_picks_validate_v2
  BEFORE INSERT OR UPDATE ON public.whale_picks
  FOR EACH ROW EXECUTE FUNCTION public.whale_picks_validate_v2();

CREATE INDEX IF NOT EXISTS idx_whale_picks_tier_active ON public.whale_picks (tier, expires_at) WHERE tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whale_picks_event_id ON public.whale_picks (event_id);
CREATE INDEX IF NOT EXISTS idx_whale_picks_sport_tier ON public.whale_picks (sport, tier) WHERE tier IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whale_picks_settlement ON public.whale_picks (settled_at) WHERE was_correct IS NULL AND tier IS NOT NULL;