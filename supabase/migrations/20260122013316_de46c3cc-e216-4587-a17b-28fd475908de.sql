-- Extend nba_team_pace_projections with additional pace metrics
ALTER TABLE public.nba_team_pace_projections 
ADD COLUMN IF NOT EXISTS team_abbrev text,
ADD COLUMN IF NOT EXISTS offensive_rating decimal,
ADD COLUMN IF NOT EXISTS defensive_rating decimal,
ADD COLUMN IF NOT EXISTS net_rating decimal,
ADD COLUMN IF NOT EXISTS games_played integer,
ADD COLUMN IF NOT EXISTS wins integer,
ADD COLUMN IF NOT EXISTS losses integer,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS last_game_date date,
ADD COLUMN IF NOT EXISTS season text DEFAULT '2025-26';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pace_team_abbrev ON nba_team_pace_projections(team_abbrev);
CREATE INDEX IF NOT EXISTS idx_pace_updated_at ON nba_team_pace_projections(updated_at);