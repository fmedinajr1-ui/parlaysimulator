-- Create NBA Risk Engine Picks table
CREATE TABLE nba_risk_engine_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  game_date DATE NOT NULL,
  event_id TEXT,
  
  -- Player & Prop
  player_name TEXT NOT NULL,
  team_name TEXT,
  opponent TEXT,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  
  -- Classifications (Step 1 & 2)
  player_role TEXT NOT NULL CHECK (player_role IN ('STAR', 'SECONDARY_GUARD', 'WING', 'BIG')),
  game_script TEXT NOT NULL CHECK (game_script IN ('COMPETITIVE', 'SOFT_BLOWOUT', 'HARD_BLOWOUT')),
  minutes_class TEXT NOT NULL CHECK (minutes_class IN ('LOCKED', 'MEDIUM', 'RISKY')),
  avg_minutes NUMERIC,
  usage_rate NUMERIC,
  
  -- Analysis Data
  spread NUMERIC,
  true_median NUMERIC,
  edge NUMERIC,
  bad_game_floor NUMERIC,
  
  -- Confidence Scoring (Step 7)
  confidence_score NUMERIC NOT NULL,
  confidence_factors JSONB,
  
  -- Outcome tracking
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('pending', 'hit', 'miss', 'push')),
  actual_value NUMERIC,
  settled_at TIMESTAMPTZ,
  
  -- Metadata
  mode TEXT DEFAULT 'full_slate',
  reason TEXT,
  rejection_reason TEXT
);

-- Indexes for efficient queries
CREATE INDEX idx_risk_engine_date ON nba_risk_engine_picks(game_date);
CREATE INDEX idx_risk_engine_confidence ON nba_risk_engine_picks(confidence_score DESC);
CREATE INDEX idx_risk_engine_outcome ON nba_risk_engine_picks(outcome);
CREATE INDEX idx_risk_engine_player ON nba_risk_engine_picks(player_name);

-- Enable RLS
ALTER TABLE nba_risk_engine_picks ENABLE ROW LEVEL SECURITY;

-- Public read access for picks
CREATE POLICY "Anyone can view risk engine picks"
ON nba_risk_engine_picks
FOR SELECT
USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can manage risk engine picks"
ON nba_risk_engine_picks
FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE nba_risk_engine_picks;