-- Create quarter_player_snapshots table for recording player diagnostics at quarter boundaries
CREATE TABLE public.quarter_player_snapshots (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  espn_event_id TEXT,
  quarter INT NOT NULL CHECK (quarter >= 1 AND quarter <= 4),
  player_name TEXT NOT NULL,
  team TEXT,
  minutes_played NUMERIC DEFAULT 0,
  points INT DEFAULT 0,
  rebounds INT DEFAULT 0,
  assists INT DEFAULT 0,
  fouls INT DEFAULT 0,
  turnovers INT DEFAULT 0,
  threes INT DEFAULT 0,
  fatigue_score INT,
  effort_score INT,
  speed_index INT,
  rebound_position_score INT,
  rotation_role TEXT,
  on_court_stability NUMERIC,
  foul_risk_level TEXT,
  player_role TEXT,
  visual_flags JSONB DEFAULT '[]'::jsonb,
  hands_on_knees_count INT DEFAULT 0,
  slow_recovery_count INT DEFAULT 0,
  sprint_count INT DEFAULT 0,
  risk_flags TEXT[],
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_player_quarter_snapshot UNIQUE (event_id, quarter, player_name)
);

-- Create indexes for efficient querying
CREATE INDEX idx_quarter_snapshots_event_quarter ON public.quarter_player_snapshots (event_id, quarter);
CREATE INDEX idx_quarter_snapshots_player ON public.quarter_player_snapshots (player_name, event_id);
CREATE INDEX idx_quarter_snapshots_captured_at ON public.quarter_player_snapshots (captured_at);

-- Enable RLS
ALTER TABLE public.quarter_player_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow public read access (diagnostic data is not sensitive)
CREATE POLICY "Quarter snapshots are publicly readable"
  ON public.quarter_player_snapshots
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert snapshots
CREATE POLICY "Authenticated users can insert quarter snapshots"
  ON public.quarter_player_snapshots
  FOR INSERT
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.quarter_player_snapshots IS 'Stores player diagnostics at quarter boundaries (Q1, Q2/Halftime, Q3, Q4) for Lock Mode validation';