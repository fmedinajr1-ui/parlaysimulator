-- Add columns for enhanced hit rate analysis with opponent data and projections
ALTER TABLE player_prop_hitrates 
ADD COLUMN IF NOT EXISTS vs_opponent_games INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS vs_opponent_hit_rate NUMERIC,
ADD COLUMN IF NOT EXISTS vs_opponent_avg NUMERIC,
ADD COLUMN IF NOT EXISTS projected_value NUMERIC,
ADD COLUMN IF NOT EXISTS projection_margin NUMERIC,
ADD COLUMN IF NOT EXISTS last_5_avg NUMERIC,
ADD COLUMN IF NOT EXISTS last_5_results JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS opponent_name TEXT;