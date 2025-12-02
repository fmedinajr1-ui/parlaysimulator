-- Create trap_patterns table to track confirmed traps
CREATE TABLE IF NOT EXISTS public.trap_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_movement_id UUID REFERENCES public.line_movements(id),
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  market_type TEXT NOT NULL,
  bookmaker TEXT,
  
  -- Trap signature characteristics
  was_single_book BOOLEAN DEFAULT false,
  price_only_move BOOLEAN DEFAULT false,
  early_morning_move BOOLEAN DEFAULT false,
  both_sides_moved BOOLEAN DEFAULT false,
  movement_size NUMERIC,
  time_before_game_hours NUMERIC,
  
  -- Outcome data
  parlay_id UUID REFERENCES public.parlay_history(id),
  confirmed_trap BOOLEAN DEFAULT true,
  loss_amount NUMERIC,
  
  -- Pattern matching
  trap_signature TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS policies
ALTER TABLE public.trap_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view trap patterns"
  ON public.trap_patterns FOR SELECT
  USING (true);

-- Add new columns to line_movements for outcome tracking
ALTER TABLE public.line_movements 
  ADD COLUMN IF NOT EXISTS outcome_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outcome_correct BOOLEAN,
  ADD COLUMN IF NOT EXISTS linked_parlay_ids UUID[],
  ADD COLUMN IF NOT EXISTS trap_score NUMERIC DEFAULT 0;

-- Create function to get similar historical patterns
CREATE OR REPLACE FUNCTION public.get_similar_historical_patterns(
  p_sport TEXT,
  p_bet_type TEXT,
  p_odds_min NUMERIC DEFAULT -200,
  p_odds_max NUMERIC DEFAULT -100,
  p_single_book BOOLEAN DEFAULT NULL,
  p_price_only BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  pattern_count BIGINT,
  win_rate NUMERIC,
  trap_rate NUMERIC,
  avg_loss_when_trap NUMERIC,
  recommendation TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH matched_patterns AS (
    SELECT 
      tp.confirmed_trap,
      tp.loss_amount,
      CASE WHEN tp.parlay_id IS NOT NULL THEN
        (SELECT ph.is_won FROM parlay_history ph WHERE ph.id = tp.parlay_id)
      ELSE NULL END as parlay_won
    FROM trap_patterns tp
    WHERE tp.sport = p_sport
      AND tp.bet_type = p_bet_type
      AND (p_single_book IS NULL OR tp.was_single_book = p_single_book)
      AND (p_price_only IS NULL OR tp.price_only_move = p_price_only)
  )
  SELECT 
    COUNT(*)::BIGINT as pattern_count,
    ROUND(
      COUNT(*) FILTER (WHERE parlay_won = true)::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE parlay_won IS NOT NULL), 0) * 100, 
      1
    ) as win_rate,
    ROUND(
      COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / 
      NULLIF(COUNT(*), 0) * 100, 
      1
    ) as trap_rate,
    ROUND(AVG(loss_amount) FILTER (WHERE confirmed_trap = true), 2) as avg_loss_when_trap,
    CASE 
      WHEN COUNT(*) < 5 THEN 'INSUFFICIENT_DATA'
      WHEN COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / NULLIF(COUNT(*), 0) > 0.6 THEN 'HIGH_TRAP_RISK'
      WHEN COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / NULLIF(COUNT(*), 0) > 0.3 THEN 'MODERATE_TRAP_RISK'
      ELSE 'LOW_TRAP_RISK'
    END as recommendation
  FROM matched_patterns;
END;
$$;

-- Create index for faster pattern matching
CREATE INDEX IF NOT EXISTS idx_trap_patterns_signature 
  ON public.trap_patterns(sport, bet_type, trap_signature);

CREATE INDEX IF NOT EXISTS idx_line_movements_outcome 
  ON public.line_movements(outcome_verified, sport, market_type);