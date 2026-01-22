-- Create game_environment_validation table for Vegas-math validation results
CREATE TABLE public.game_environment_validation (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL,
  line DECIMAL NOT NULL,
  game_date DATE NOT NULL DEFAULT CURRENT_DATE,
  team_name TEXT,
  opponent_team TEXT,
  
  -- Game Environment Data
  vegas_total DECIMAL,
  vegas_spread DECIMAL,
  team_implied_total DECIMAL,
  opponent_implied_total DECIMAL,
  
  -- Pace Data
  team_pace DECIMAL,
  opponent_pace DECIMAL,
  expected_game_pace DECIMAL,
  pace_class TEXT,  -- FAST / NEUTRAL / SLOW
  
  -- Defensive Data
  opp_defense_rank INTEGER,
  opp_position_defense_rank INTEGER,
  opp_stat_allowed DECIMAL,
  
  -- Player Role
  player_role TEXT,  -- PRIMARY / SECONDARY / ROLE / BENCH
  avg_minutes DECIMAL,
  is_starter BOOLEAN DEFAULT true,
  player_archetype TEXT,
  
  -- Validation Result
  validation_status TEXT NOT NULL DEFAULT 'PENDING',  -- APPROVED / CONDITIONAL / REJECTED / PENDING
  rejection_reason TEXT,
  implied_total_check BOOLEAN DEFAULT true,
  pace_check BOOLEAN DEFAULT true,
  defense_check BOOLEAN DEFAULT true,
  role_check BOOLEAN DEFAULT true,
  game_script_check BOOLEAN DEFAULT true,
  prop_type_check BOOLEAN DEFAULT true,
  confidence_adjustment DECIMAL DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint to prevent duplicates
  CONSTRAINT unique_player_prop_validation UNIQUE (player_name, prop_type, side, line, game_date)
);

-- Enable RLS
ALTER TABLE public.game_environment_validation ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access to game_environment_validation"
  ON public.game_environment_validation
  FOR SELECT
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to game_environment_validation"
  ON public.game_environment_validation
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create indexes for efficient queries
CREATE INDEX idx_game_env_validation_date ON public.game_environment_validation(game_date);
CREATE INDEX idx_game_env_validation_status ON public.game_environment_validation(validation_status);
CREATE INDEX idx_game_env_validation_player ON public.game_environment_validation(player_name);
CREATE INDEX idx_game_env_validation_lookup ON public.game_environment_validation(player_name, prop_type, side, game_date);

-- Create trigger for updated_at
CREATE TRIGGER update_game_environment_validation_updated_at
  BEFORE UPDATE ON public.game_environment_validation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();