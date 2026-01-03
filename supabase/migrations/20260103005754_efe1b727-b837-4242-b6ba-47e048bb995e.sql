-- Create nba_defense_codes table for per-stat defense scoring
CREATE TABLE IF NOT EXISTS nba_defense_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_name TEXT NOT NULL,
  team_abbreviation TEXT,
  vs_points_code INTEGER CHECK (vs_points_code >= 0 AND vs_points_code <= 100),
  vs_rebounds_code INTEGER CHECK (vs_rebounds_code >= 0 AND vs_rebounds_code <= 100),
  vs_assists_code INTEGER CHECK (vs_assists_code >= 0 AND vs_assists_code <= 100),
  pace_code INTEGER,
  season TEXT DEFAULT '2024-25',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_name, season)
);

-- Enable RLS
ALTER TABLE nba_defense_codes ENABLE ROW LEVEL SECURITY;

-- Public read access for edge functions
CREATE POLICY "Allow public read on nba_defense_codes" 
ON nba_defense_codes FOR SELECT USING (true);

-- Service role write access
CREATE POLICY "Allow service role write on nba_defense_codes" 
ON nba_defense_codes FOR ALL USING (true);

-- Add v2 columns to median_edge_picks table
ALTER TABLE median_edge_picks 
ADD COLUMN IF NOT EXISTS adjusted_median NUMERIC,
ADD COLUMN IF NOT EXISTS defense_code INTEGER,
ADD COLUMN IF NOT EXISTS defense_multiplier NUMERIC,
ADD COLUMN IF NOT EXISTS hit_rate_over_10 NUMERIC,
ADD COLUMN IF NOT EXISTS hit_rate_under_10 NUMERIC,
ADD COLUMN IF NOT EXISTS median5 NUMERIC,
ADD COLUMN IF NOT EXISTS volatility NUMERIC,
ADD COLUMN IF NOT EXISTS confidence_tier TEXT DEFAULT 'D',
ADD COLUMN IF NOT EXISTS engine_version TEXT DEFAULT 'v1';

-- Seed nba_defense_codes from team_defense_rankings
-- Converting rank 1-30 to code 0-100 (rank 1 = 100, rank 30 = 0)
INSERT INTO nba_defense_codes (team_name, team_abbreviation, vs_points_code, vs_rebounds_code, vs_assists_code, season)
SELECT 
  team_name,
  team_abbreviation,
  ROUND(100 - ((overall_rank - 1) * 3.45))::INTEGER as vs_points_code,
  ROUND(100 - ((overall_rank - 1) * 3.45))::INTEGER as vs_rebounds_code,
  ROUND(100 - ((overall_rank - 1) * 3.45))::INTEGER as vs_assists_code,
  '2024-25'
FROM team_defense_rankings
WHERE sport = 'NBA' AND is_current = true
ON CONFLICT (team_name, season) DO UPDATE SET
  vs_points_code = EXCLUDED.vs_points_code,
  vs_rebounds_code = EXCLUDED.vs_rebounds_code,
  vs_assists_code = EXCLUDED.vs_assists_code,
  updated_at = NOW();