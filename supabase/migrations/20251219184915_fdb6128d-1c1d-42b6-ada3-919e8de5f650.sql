-- Add new tracking columns to median_lock_candidates if they don't exist
DO $$ 
BEGIN
  -- Add engine_side_matched_book column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'median_lock_candidates' AND column_name = 'engine_side_matched_book') THEN
    ALTER TABLE median_lock_candidates ADD COLUMN engine_side_matched_book BOOLEAN DEFAULT NULL;
  END IF;
  
  -- Add book_recommended_side column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'median_lock_candidates' AND column_name = 'book_recommended_side') THEN
    ALTER TABLE median_lock_candidates ADD COLUMN book_recommended_side TEXT DEFAULT NULL;
  END IF;
END $$;

-- Create team_defense_rankings table if it doesn't exist
CREATE TABLE IF NOT EXISTS team_defense_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbreviation TEXT NOT NULL,
  team_name TEXT,
  sport TEXT NOT NULL DEFAULT 'NBA',
  overall_rank INTEGER NOT NULL,
  points_allowed_rank INTEGER,
  efficiency_rank INTEGER,
  is_current BOOLEAN DEFAULT true,
  season TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_abbreviation, sport, season)
);

-- Enable RLS
ALTER TABLE team_defense_rankings ENABLE ROW LEVEL SECURITY;

-- Create policy for read access (public read for defense rankings)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read defense rankings') THEN
    CREATE POLICY "Anyone can read defense rankings" ON team_defense_rankings FOR SELECT USING (true);
  END IF;
END $$;

-- Seed current NBA defense rankings (2024-25 season estimates)
INSERT INTO team_defense_rankings (team_abbreviation, team_name, sport, overall_rank, is_current, season)
VALUES 
  ('OKC', 'Oklahoma City Thunder', 'NBA', 1, true, '2024-25'),
  ('CLE', 'Cleveland Cavaliers', 'NBA', 2, true, '2024-25'),
  ('MIN', 'Minnesota Timberwolves', 'NBA', 3, true, '2024-25'),
  ('BOS', 'Boston Celtics', 'NBA', 4, true, '2024-25'),
  ('MEM', 'Memphis Grizzlies', 'NBA', 5, true, '2024-25'),
  ('HOU', 'Houston Rockets', 'NBA', 6, true, '2024-25'),
  ('ORL', 'Orlando Magic', 'NBA', 7, true, '2024-25'),
  ('DEN', 'Denver Nuggets', 'NBA', 8, true, '2024-25'),
  ('LAL', 'Los Angeles Lakers', 'NBA', 9, true, '2024-25'),
  ('NYK', 'New York Knicks', 'NBA', 10, true, '2024-25'),
  ('SAC', 'Sacramento Kings', 'NBA', 11, true, '2024-25'),
  ('MIA', 'Miami Heat', 'NBA', 12, true, '2024-25'),
  ('GSW', 'Golden State Warriors', 'NBA', 13, true, '2024-25'),
  ('DAL', 'Dallas Mavericks', 'NBA', 14, true, '2024-25'),
  ('PHX', 'Phoenix Suns', 'NBA', 15, true, '2024-25'),
  ('DET', 'Detroit Pistons', 'NBA', 16, true, '2024-25'),
  ('MIL', 'Milwaukee Bucks', 'NBA', 17, true, '2024-25'),
  ('IND', 'Indiana Pacers', 'NBA', 18, true, '2024-25'),
  ('CHI', 'Chicago Bulls', 'NBA', 19, true, '2024-25'),
  ('NOP', 'New Orleans Pelicans', 'NBA', 20, true, '2024-25'),
  ('TOR', 'Toronto Raptors', 'NBA', 21, true, '2024-25'),
  ('BKN', 'Brooklyn Nets', 'NBA', 22, true, '2024-25'),
  ('PHI', 'Philadelphia 76ers', 'NBA', 23, true, '2024-25'),
  ('LAC', 'Los Angeles Clippers', 'NBA', 24, true, '2024-25'),
  ('ATL', 'Atlanta Hawks', 'NBA', 25, true, '2024-25'),
  ('POR', 'Portland Trail Blazers', 'NBA', 26, true, '2024-25'),
  ('SAS', 'San Antonio Spurs', 'NBA', 27, true, '2024-25'),
  ('CHA', 'Charlotte Hornets', 'NBA', 28, true, '2024-25'),
  ('UTA', 'Utah Jazz', 'NBA', 29, true, '2024-25'),
  ('WAS', 'Washington Wizards', 'NBA', 30, true, '2024-25')
ON CONFLICT (team_abbreviation, sport, season) DO UPDATE SET
  overall_rank = EXCLUDED.overall_rank,
  updated_at = NOW();

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_team_defense_rankings_lookup 
  ON team_defense_rankings(team_abbreviation, sport, is_current);