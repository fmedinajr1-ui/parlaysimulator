-- Create juiced prop movement history table for day-long tracking
CREATE TABLE public.juiced_prop_movement_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  juiced_prop_id UUID REFERENCES juiced_props(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  over_price NUMERIC NOT NULL,
  under_price NUMERIC NOT NULL,
  snapshot_time TIMESTAMP WITH TIME ZONE DEFAULT now(),
  movement_direction TEXT, -- 'towards_over', 'towards_under', 'stable'
  cumulative_over_moves INTEGER DEFAULT 0,
  cumulative_under_moves INTEGER DEFAULT 0,
  price_delta NUMERIC DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.juiced_prop_movement_history ENABLE ROW LEVEL SECURITY;

-- Anyone can view movement history
CREATE POLICY "Anyone can view movement history" 
ON public.juiced_prop_movement_history 
FOR SELECT 
USING (true);

-- Create index for fast lookups
CREATE INDEX idx_juiced_movement_prop_id ON public.juiced_prop_movement_history(juiced_prop_id);
CREATE INDEX idx_juiced_movement_snapshot_time ON public.juiced_prop_movement_history(snapshot_time);

-- Add movement consistency columns to juiced_props
ALTER TABLE public.juiced_props 
ADD COLUMN IF NOT EXISTS movement_consistency_score NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_movement_snapshots INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS consistent_direction_moves INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dominant_movement_direction TEXT;