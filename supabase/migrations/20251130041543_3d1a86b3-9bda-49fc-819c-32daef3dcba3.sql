-- Create odds snapshots table to track historical odds
CREATE TABLE public.odds_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMP WITH TIME ZONE,
  bookmaker TEXT NOT NULL,
  market_type TEXT NOT NULL DEFAULT 'spreads',
  outcome_name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  point NUMERIC,
  snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_odds_snapshots_event ON public.odds_snapshots(event_id, bookmaker, outcome_name);
CREATE INDEX idx_odds_snapshots_time ON public.odds_snapshots(snapshot_time DESC);
CREATE INDEX idx_odds_snapshots_sport ON public.odds_snapshots(sport);

-- Enable RLS
ALTER TABLE public.odds_snapshots ENABLE ROW LEVEL SECURITY;

-- Anyone can view odds snapshots
CREATE POLICY "Anyone can view odds snapshots"
ON public.odds_snapshots
FOR SELECT
USING (true);

-- Create line movements table to track significant changes
CREATE TABLE public.line_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  description TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  old_price NUMERIC NOT NULL,
  new_price NUMERIC NOT NULL,
  old_point NUMERIC,
  new_point NUMERIC,
  price_change NUMERIC NOT NULL,
  point_change NUMERIC,
  movement_type TEXT NOT NULL DEFAULT 'price',
  is_sharp_action BOOLEAN DEFAULT false,
  sharp_indicator TEXT,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  commence_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_line_movements_event ON public.line_movements(event_id);
CREATE INDEX idx_line_movements_sharp ON public.line_movements(is_sharp_action) WHERE is_sharp_action = true;
CREATE INDEX idx_line_movements_time ON public.line_movements(detected_at DESC);
CREATE INDEX idx_line_movements_sport ON public.line_movements(sport);

-- Enable RLS
ALTER TABLE public.line_movements ENABLE ROW LEVEL SECURITY;

-- Anyone can view line movements
CREATE POLICY "Anyone can view line movements"
ON public.line_movements
FOR SELECT
USING (true);

-- Function to detect sharp money based on line movement patterns
CREATE OR REPLACE FUNCTION public.detect_sharp_money(
  p_price_change NUMERIC,
  p_point_change NUMERIC DEFAULT NULL
)
RETURNS TABLE(is_sharp BOOLEAN, indicator TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Sharp money indicators:
  -- 1. Large price movement (10+ points) without point spread change
  -- 2. Reverse line movement (line moves against public betting)
  -- 3. Quick significant movement (steam move)
  
  IF ABS(p_price_change) >= 15 THEN
    RETURN QUERY SELECT true, 'STEAM MOVE - Major price shift detected';
  ELSIF ABS(p_price_change) >= 10 AND (p_point_change IS NULL OR ABS(p_point_change) < 0.5) THEN
    RETURN QUERY SELECT true, 'SHARP ACTION - Price moved without spread change';
  ELSIF ABS(p_price_change) >= 8 THEN
    RETURN QUERY SELECT true, 'POSSIBLE SHARP - Significant line movement';
  ELSE
    RETURN QUERY SELECT false, NULL;
  END IF;
END;
$$;

-- Function to get recent line movements for a sport
CREATE OR REPLACE FUNCTION public.get_recent_line_movements(
  p_sport TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  id UUID,
  event_id TEXT,
  sport TEXT,
  description TEXT,
  bookmaker TEXT,
  market_type TEXT,
  outcome_name TEXT,
  old_price NUMERIC,
  new_price NUMERIC,
  price_change NUMERIC,
  point_change NUMERIC,
  is_sharp_action BOOLEAN,
  sharp_indicator TEXT,
  detected_at TIMESTAMP WITH TIME ZONE,
  commence_time TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lm.id,
    lm.event_id,
    lm.sport,
    lm.description,
    lm.bookmaker,
    lm.market_type,
    lm.outcome_name,
    lm.old_price,
    lm.new_price,
    lm.price_change,
    lm.point_change,
    lm.is_sharp_action,
    lm.sharp_indicator,
    lm.detected_at,
    lm.commence_time
  FROM line_movements lm
  WHERE (p_sport IS NULL OR lm.sport = p_sport)
  ORDER BY lm.detected_at DESC
  LIMIT p_limit;
END;
$$;