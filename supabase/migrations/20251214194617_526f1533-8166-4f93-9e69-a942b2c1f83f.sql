-- Table to store historical leg correlations by market type pairs
CREATE TABLE public.parlay_leg_correlations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  market_type_1 TEXT NOT NULL,
  market_type_2 TEXT NOT NULL,
  correlation_type TEXT NOT NULL DEFAULT 'same_game', -- same_game, same_team, same_player, cross_game
  correlation_coefficient NUMERIC NOT NULL DEFAULT 0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  confidence_interval_low NUMERIC,
  confidence_interval_high NUMERIC,
  last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sport, market_type_1, market_type_2, correlation_type)
);

-- Enable RLS
ALTER TABLE public.parlay_leg_correlations ENABLE ROW LEVEL SECURITY;

-- Anyone can view correlations
CREATE POLICY "Anyone can view leg correlations"
ON public.parlay_leg_correlations
FOR SELECT
USING (true);

-- Create index for fast lookups
CREATE INDEX idx_leg_correlations_lookup 
ON public.parlay_leg_correlations(sport, market_type_1, market_type_2, correlation_type);

-- Seed with common correlation patterns based on industry research
INSERT INTO public.parlay_leg_correlations (sport, market_type_1, market_type_2, correlation_type, correlation_coefficient, sample_size)
VALUES
  -- NBA Same-Game Correlations (research-backed)
  ('basketball_nba', 'player_points', 'player_assists', 'same_player', 0.35, 1000),
  ('basketball_nba', 'player_points', 'player_rebounds', 'same_player', 0.25, 1000),
  ('basketball_nba', 'player_rebounds', 'player_assists', 'same_player', 0.15, 1000),
  ('basketball_nba', 'spreads', 'totals', 'same_game', 0.12, 1000),
  ('basketball_nba', 'player_points', 'team_totals', 'same_game', 0.45, 1000),
  ('basketball_nba', 'moneyline', 'spreads', 'same_game', 0.95, 1000),
  
  -- NFL Same-Game Correlations
  ('americanfootball_nfl', 'player_pass_yds', 'player_pass_tds', 'same_player', 0.55, 1000),
  ('americanfootball_nfl', 'player_rush_yds', 'player_rush_tds', 'same_player', 0.40, 1000),
  ('americanfootball_nfl', 'player_rec_yds', 'player_receptions', 'same_player', 0.65, 1000),
  ('americanfootball_nfl', 'spreads', 'totals', 'same_game', 0.18, 1000),
  ('americanfootball_nfl', 'moneyline', 'spreads', 'same_game', 0.92, 1000),
  
  -- NHL Same-Game Correlations
  ('icehockey_nhl', 'player_points', 'player_assists', 'same_player', 0.50, 1000),
  ('icehockey_nhl', 'player_goals', 'player_shots', 'same_player', 0.35, 1000),
  ('icehockey_nhl', 'spreads', 'totals', 'same_game', 0.15, 1000),
  
  -- Cross-game correlations (generally low/zero)
  ('basketball_nba', 'player_points', 'player_points', 'cross_game', 0.05, 1000),
  ('americanfootball_nfl', 'player_pass_yds', 'player_pass_yds', 'cross_game', 0.03, 1000);

-- Trigger to update updated_at
CREATE TRIGGER update_parlay_leg_correlations_updated_at
BEFORE UPDATE ON public.parlay_leg_correlations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();