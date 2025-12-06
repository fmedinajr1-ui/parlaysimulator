-- Add hit streak tracking columns to player_prop_hitrates
ALTER TABLE player_prop_hitrates 
ADD COLUMN IF NOT EXISTS hit_streak TEXT,
ADD COLUMN IF NOT EXISTS is_perfect_streak BOOLEAN DEFAULT false;

-- Add hit streak to hitrate_parlays
ALTER TABLE hitrate_parlays
ADD COLUMN IF NOT EXISTS hit_streak TEXT;

-- Create index for NBA prop queries with streaks
CREATE INDEX IF NOT EXISTS idx_hitrates_nba_streak ON player_prop_hitrates (sport, hit_streak, confidence_score DESC) 
WHERE sport = 'basketball_nba';