-- Sweet Spot Tracking Table for Pick Verification
CREATE TABLE IF NOT EXISTS sweet_spot_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  game_date DATE NOT NULL,
  pick_id UUID,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL,
  edge NUMERIC NOT NULL,
  archetype TEXT,
  sweet_spot_reason TEXT NOT NULL,
  outcome TEXT DEFAULT 'pending',
  actual_value NUMERIC,
  verified_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for quick lookups
CREATE INDEX idx_sweet_spot_game_date ON sweet_spot_tracking(game_date);
CREATE INDEX idx_sweet_spot_outcome ON sweet_spot_tracking(outcome);
CREATE INDEX idx_sweet_spot_prop_type ON sweet_spot_tracking(prop_type);

-- Enable RLS
ALTER TABLE sweet_spot_tracking ENABLE ROW LEVEL SECURITY;

-- Public read access for tracking display
CREATE POLICY "Allow public read access on sweet_spot_tracking"
ON sweet_spot_tracking FOR SELECT
USING (true);

-- Insert today's 3 sweet spot picks for tracking
INSERT INTO sweet_spot_tracking (game_date, pick_id, player_name, prop_type, line, side, confidence_score, edge, archetype, sweet_spot_reason)
VALUES 
  ('2026-01-13', '8fe47a24-8bbf-4108-8c99-770807893bcc', 'Steven Adams', 'rebounds', 5, 'over', 9.7, 2.0, 'ELITE_REBOUNDER', 'REBOUNDS_SWEET_SPOT_9.0-9.8'),
  ('2026-01-13', 'c93ad396-d316-4553-87ec-e7535eee1af6', 'Ayo Dosunmu', 'rebounds', 2.5, 'over', 9.2, 1.5, 'PLAYMAKER', 'REBOUNDS_SWEET_SPOT_9.0-9.8'),
  ('2026-01-13', 'ea913535-2411-4635-afa8-8b689bbae098', 'Isaac Okoro', 'rebounds', 2.5, 'over', 9.2, 1.5, 'TWO_WAY_WING', 'REBOUNDS_SWEET_SPOT_9.0-9.8');