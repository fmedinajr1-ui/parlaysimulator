-- Create table for caching BallDontLie player ID mappings
CREATE TABLE IF NOT EXISTS public.bdl_player_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL UNIQUE,
  bdl_player_id INTEGER,
  position TEXT,
  team_name TEXT,
  height TEXT,
  weight TEXT,
  jersey_number TEXT,
  college TEXT,
  country TEXT,
  draft_year INTEGER,
  draft_round INTEGER,
  draft_number INTEGER,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bdl_player_cache_name ON public.bdl_player_cache (player_name);
CREATE INDEX IF NOT EXISTS idx_bdl_player_cache_bdl_id ON public.bdl_player_cache (bdl_player_id);

-- Enable RLS
ALTER TABLE public.bdl_player_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access (this is reference data)
CREATE POLICY "Anyone can read player cache" ON public.bdl_player_cache
  FOR SELECT USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage player cache" ON public.bdl_player_cache
  FOR ALL USING (true) WITH CHECK (true);