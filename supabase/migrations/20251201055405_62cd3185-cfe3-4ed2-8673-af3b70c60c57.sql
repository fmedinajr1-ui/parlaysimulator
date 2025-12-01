-- Add player_name column to odds_snapshots table
ALTER TABLE public.odds_snapshots ADD COLUMN IF NOT EXISTS player_name TEXT;

-- Add player_name column to line_movements table  
ALTER TABLE public.line_movements ADD COLUMN IF NOT EXISTS player_name TEXT;

-- Create index for faster player prop queries
CREATE INDEX IF NOT EXISTS idx_line_movements_player_name ON public.line_movements(player_name) WHERE player_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_odds_snapshots_player_name ON public.odds_snapshots(player_name) WHERE player_name IS NOT NULL;