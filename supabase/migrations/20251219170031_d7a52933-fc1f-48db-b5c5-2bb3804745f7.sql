-- Add unique constraint for first_scorer_props upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_first_scorer_unique 
ON first_scorer_props(game_id, prop_type, selection);