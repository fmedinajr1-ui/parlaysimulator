-- Add game status columns to median_lock_candidates
ALTER TABLE median_lock_candidates
ADD COLUMN IF NOT EXISTS game_status TEXT DEFAULT 'scheduled' CHECK (game_status IN ('scheduled', 'live', 'final', 'postponed')),
ADD COLUMN IF NOT EXISTS game_start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS game_final_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS home_team TEXT,
ADD COLUMN IF NOT EXISTS away_team TEXT,
ADD COLUMN IF NOT EXISTS home_score INTEGER,
ADD COLUMN IF NOT EXISTS away_score INTEGER,
ADD COLUMN IF NOT EXISTS game_clock TEXT,
ADD COLUMN IF NOT EXISTS game_period TEXT,
ADD COLUMN IF NOT EXISTS actual_value NUMERIC;

-- Create index for efficient status queries
CREATE INDEX IF NOT EXISTS idx_median_lock_game_status 
ON median_lock_candidates(game_status, slate_date);

-- Enable realtime for the table
ALTER PUBLICATION supabase_realtime ADD TABLE median_lock_candidates;