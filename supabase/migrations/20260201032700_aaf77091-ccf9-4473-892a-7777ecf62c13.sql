-- Add 3PT attempts tracking to game logs
ALTER TABLE nba_player_game_logs
ADD COLUMN IF NOT EXISTS threes_attempted integer DEFAULT 0;

-- Add index for efficient L5/L10 queries by player and date
CREATE INDEX IF NOT EXISTS idx_game_logs_player_date 
ON nba_player_game_logs(player_name, game_date DESC);

-- Add new fields to category_sweet_spots for enhanced 3PT analysis
ALTER TABLE category_sweet_spots
ADD COLUMN IF NOT EXISTS l5_three_pct numeric,
ADD COLUMN IF NOT EXISTS h2h_matchup_boost numeric,
ADD COLUMN IF NOT EXISTS h2h_avg_vs_opponent numeric,
ADD COLUMN IF NOT EXISTS shooting_efficiency_tier text;