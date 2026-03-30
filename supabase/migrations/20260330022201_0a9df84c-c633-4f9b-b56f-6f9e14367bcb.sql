
CREATE TABLE public.scale_in_tracker (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_description TEXT,
  sport TEXT,
  side TEXT NOT NULL,
  initial_line NUMERIC NOT NULL,
  current_line NUMERIC NOT NULL,
  best_line NUMERIC,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  phase INTEGER NOT NULL DEFAULT 1,
  total_units_deployed NUMERIC NOT NULL DEFAULT 0.25,
  avg_entry_line NUMERIC,
  opponent TEXT,
  matchup_edge_pct NUMERIC,
  hit_rate NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  outcome TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_name, prop_type, event_id)
);

ALTER TABLE public.scale_in_tracker ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access" ON public.scale_in_tracker
  FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_scale_in_active ON public.scale_in_tracker (is_active, created_at DESC);
CREATE INDEX idx_scale_in_event ON public.scale_in_tracker (event_id, player_name, prop_type);
