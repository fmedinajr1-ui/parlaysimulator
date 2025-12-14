-- Create engine_live_tracker table for real-time picks from all engines
CREATE TABLE IF NOT EXISTS public.engine_live_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  pick_description TEXT NOT NULL,
  player_name TEXT,
  team_name TEXT,
  prop_type TEXT,
  line NUMERIC,
  side TEXT,
  odds INTEGER,
  confidence NUMERIC,
  confidence_level TEXT,
  signals JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'push', 'void')),
  event_id TEXT,
  game_time TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for faster querying
CREATE INDEX IF NOT EXISTS idx_engine_tracker_sport ON engine_live_tracker(sport);
CREATE INDEX IF NOT EXISTS idx_engine_tracker_engine ON engine_live_tracker(engine_name);
CREATE INDEX IF NOT EXISTS idx_engine_tracker_status ON engine_live_tracker(status);
CREATE INDEX IF NOT EXISTS idx_engine_tracker_created ON engine_live_tracker(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_engine_tracker_game_time ON engine_live_tracker(game_time);

-- Enable RLS
ALTER TABLE public.engine_live_tracker ENABLE ROW LEVEL SECURITY;

-- Public read access (everyone can see live picks)
CREATE POLICY "Engine tracker is publicly readable"
ON public.engine_live_tracker
FOR SELECT
USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage engine tracker"
ON public.engine_live_tracker
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.engine_live_tracker;

-- Create updated_at trigger
CREATE OR REPLACE TRIGGER update_engine_tracker_updated_at
  BEFORE UPDATE ON public.engine_live_tracker
  FOR EACH ROW
  EXECUTE FUNCTION public.update_god_mode_updated_at();