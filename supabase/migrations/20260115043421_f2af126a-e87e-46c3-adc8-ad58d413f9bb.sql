-- Create scout_sessions table for persistent session storage
CREATE TABLE public.scout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  player_states JSONB NOT NULL DEFAULT '{}',
  prop_edges JSONB NOT NULL DEFAULT '[]',
  projection_snapshots JSONB NOT NULL DEFAULT '[]',
  halftime_lock JSONB,
  pbp_data JSONB,
  current_game_time TEXT,
  current_score TEXT,
  frames_processed INTEGER DEFAULT 0,
  analysis_count INTEGER DEFAULT 0,
  commercial_skip_count INTEGER DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id)
);

-- Enable RLS
ALTER TABLE public.scout_sessions ENABLE ROW LEVEL SECURITY;

-- Create policy for public read/write (since this is session data, not user-specific)
CREATE POLICY "Scout sessions are publicly accessible" 
ON public.scout_sessions 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Enable realtime for live session updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.scout_sessions;

-- Create index for faster lookups
CREATE INDEX idx_scout_sessions_event_id ON public.scout_sessions(event_id);
CREATE INDEX idx_scout_sessions_last_updated ON public.scout_sessions(last_updated_at DESC);