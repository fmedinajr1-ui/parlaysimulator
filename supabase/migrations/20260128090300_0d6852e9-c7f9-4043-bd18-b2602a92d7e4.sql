-- Create user_parlay_outcomes table for learning system
CREATE TABLE public.user_parlay_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_date DATE NOT NULL,
  total_legs INTEGER NOT NULL,
  wager_amount NUMERIC,
  payout_amount NUMERIC,
  total_odds TEXT,
  legs JSONB NOT NULL,
  outcome TEXT DEFAULT 'pending',
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_parlay_outcomes ENABLE ROW LEVEL SECURITY;

-- Public read/write for now (no auth required for this learning table)
CREATE POLICY "Allow public read access to parlay outcomes"
  ON public.user_parlay_outcomes FOR SELECT USING (true);

CREATE POLICY "Allow public insert to parlay outcomes"
  ON public.user_parlay_outcomes FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update to parlay outcomes"
  ON public.user_parlay_outcomes FOR UPDATE USING (true);

-- Create index for date lookups
CREATE INDEX idx_user_parlay_outcomes_date ON public.user_parlay_outcomes(parlay_date DESC);
CREATE INDEX idx_user_parlay_outcomes_outcome ON public.user_parlay_outcomes(outcome);

-- Create v_3pt_matchup_favorites view for H2H analysis
CREATE OR REPLACE VIEW public.v_3pt_matchup_favorites AS
SELECT 
  player_name,
  opponent,
  games_played,
  avg_stat AS avg_3pt_vs_team,
  min_stat AS worst_3pt_vs_team,
  max_stat AS best_3pt_vs_team,
  CASE 
    WHEN min_stat >= 2 THEN 'ELITE_MATCHUP'
    WHEN min_stat >= 1 THEN 'GOOD_MATCHUP'
    ELSE 'VOLATILE_MATCHUP'
  END AS matchup_tier
FROM matchup_history
WHERE prop_type = 'player_threes'
AND games_played >= 2
ORDER BY min_stat DESC, avg_stat DESC;