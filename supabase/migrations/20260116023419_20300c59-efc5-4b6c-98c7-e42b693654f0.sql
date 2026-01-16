-- Add is_active column with default FALSE (assume inactive until proven active via ESPN sync)
ALTER TABLE bdl_player_cache 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE;

-- Create index for fast filtering by active status
CREATE INDEX IF NOT EXISTS idx_bdl_player_cache_is_active 
ON bdl_player_cache(is_active);

-- Create composite index for team + active queries
CREATE INDEX IF NOT EXISTS idx_bdl_player_cache_team_active 
ON bdl_player_cache(team_name, is_active);