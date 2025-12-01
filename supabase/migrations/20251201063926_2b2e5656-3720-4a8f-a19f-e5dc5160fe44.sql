-- Create juiced_props table for morning scans and final picks
CREATE TABLE public.juiced_props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  game_description TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  over_price NUMERIC NOT NULL,
  under_price NUMERIC NOT NULL,
  opening_over_price NUMERIC,
  juice_level TEXT NOT NULL,
  juice_direction TEXT NOT NULL,
  juice_amount NUMERIC NOT NULL,
  final_pick TEXT,
  final_pick_reason TEXT,
  final_pick_confidence NUMERIC,
  commence_time TIMESTAMPTZ NOT NULL,
  morning_scan_time TIMESTAMPTZ DEFAULT now(),
  final_pick_time TIMESTAMPTZ,
  is_locked BOOLEAN DEFAULT false,
  bookmaker TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.juiced_props ENABLE ROW LEVEL SECURITY;

-- Anyone can view juiced props
CREATE POLICY "Anyone can view juiced props"
ON public.juiced_props
FOR SELECT
USING (true);

-- Create index for efficient queries
CREATE INDEX idx_juiced_props_commence_time ON public.juiced_props(commence_time);
CREATE INDEX idx_juiced_props_is_locked ON public.juiced_props(is_locked);
CREATE INDEX idx_juiced_props_sport ON public.juiced_props(sport);