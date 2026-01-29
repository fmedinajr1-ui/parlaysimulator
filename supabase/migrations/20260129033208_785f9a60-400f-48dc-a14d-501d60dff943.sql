-- Add L5 columns for hot/cold detection to player_season_stats
ALTER TABLE player_season_stats
ADD COLUMN IF NOT EXISTS last_5_avg_points NUMERIC,
ADD COLUMN IF NOT EXISTS last_5_avg_rebounds NUMERIC,
ADD COLUMN IF NOT EXISTS last_5_avg_assists NUMERIC,
ADD COLUMN IF NOT EXISTS last_5_avg_threes NUMERIC;

-- Add quality tier column to category_sweet_spots for 3PT validation results
ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS quality_tier TEXT;

COMMENT ON COLUMN player_season_stats.last_5_avg_points IS 'Last 5 game average for points - used for hot/cold detection';
COMMENT ON COLUMN player_season_stats.last_5_avg_rebounds IS 'Last 5 game average for rebounds - used for hot/cold detection';
COMMENT ON COLUMN player_season_stats.last_5_avg_assists IS 'Last 5 game average for assists - used for hot/cold detection';
COMMENT ON COLUMN player_season_stats.last_5_avg_threes IS 'Last 5 game average for threes - used for hot/cold detection';
COMMENT ON COLUMN category_sweet_spots.quality_tier IS 'Quality classification for picks: ELITE, PREMIUM, STANDARD, HOT, COLD, BLOCKED';