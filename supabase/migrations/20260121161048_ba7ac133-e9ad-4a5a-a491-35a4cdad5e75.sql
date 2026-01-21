-- Add position-specific defense columns and game script columns to matchup_intelligence
ALTER TABLE public.matchup_intelligence 
ADD COLUMN IF NOT EXISTS position_group TEXT DEFAULT 'all',
ADD COLUMN IF NOT EXISTS position_defense_rank INTEGER,
ADD COLUMN IF NOT EXISTS position_defense_allowed NUMERIC,
ADD COLUMN IF NOT EXISTS game_script TEXT DEFAULT 'COMPETITIVE',
ADD COLUMN IF NOT EXISTS game_script_confidence NUMERIC DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS prop_implications JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS player_position TEXT;

-- Add game_script column to game_environment table
ALTER TABLE public.game_environment
ADD COLUMN IF NOT EXISTS game_script TEXT DEFAULT 'COMPETITIVE',
ADD COLUMN IF NOT EXISTS game_script_confidence NUMERIC DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS shootout_factor NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS grind_factor NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS garbage_time_risk NUMERIC DEFAULT 0;

-- Add position-specific tracking columns to team_defensive_ratings
ALTER TABLE public.team_defensive_ratings
ADD COLUMN IF NOT EXISTS vs_guards_rank INTEGER,
ADD COLUMN IF NOT EXISTS vs_guards_allowed NUMERIC,
ADD COLUMN IF NOT EXISTS vs_wings_rank INTEGER,
ADD COLUMN IF NOT EXISTS vs_wings_allowed NUMERIC,
ADD COLUMN IF NOT EXISTS vs_bigs_rank INTEGER,
ADD COLUMN IF NOT EXISTS vs_bigs_allowed NUMERIC;

-- Create index for faster position-group lookups
CREATE INDEX IF NOT EXISTS idx_team_defense_position ON public.team_defensive_ratings(team_name, stat_type, position_group);

-- Create index for game script lookups
CREATE INDEX IF NOT EXISTS idx_game_env_script ON public.game_environment(game_date, game_script);