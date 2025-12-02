-- Create sharp_line_tracker table for tracking props from opening to close
CREATE TABLE public.sharp_line_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Prop identification
  event_id TEXT,
  sport TEXT NOT NULL CHECK (sport IN ('basketball_nba', 'americanfootball_nfl')),
  game_description TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  
  -- Opening odds (early morning)
  opening_line NUMERIC NOT NULL,
  opening_over_price NUMERIC NOT NULL,
  opening_under_price NUMERIC NOT NULL,
  opening_time TIMESTAMPTZ DEFAULT NOW(),
  
  -- Current odds (updated later)
  current_line NUMERIC,
  current_over_price NUMERIC,
  current_under_price NUMERIC,
  last_updated TIMESTAMPTZ,
  
  -- Movement analysis
  line_movement NUMERIC GENERATED ALWAYS AS (current_line - opening_line) STORED,
  price_movement_over NUMERIC GENERATED ALWAYS AS (current_over_price - opening_over_price) STORED,
  price_movement_under NUMERIC GENERATED ALWAYS AS (current_under_price - opening_under_price) STORED,
  
  -- AI Analysis
  ai_recommendation TEXT CHECK (ai_recommendation IN ('pick', 'fade', 'caution')),
  ai_direction TEXT CHECK (ai_direction IN ('over', 'under')),
  ai_confidence NUMERIC CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_reasoning TEXT,
  ai_signals JSONB DEFAULT '{"sharp": [], "trap": []}'::jsonb,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'updated', 'analyzed', 'locked')),
  input_method TEXT DEFAULT 'manual' CHECK (input_method IN ('manual', 'scan')),
  
  -- Game timing
  commence_time TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.sharp_line_tracker ENABLE ROW LEVEL SECURITY;

-- Admins can manage all records
CREATE POLICY "Admins can manage sharp line tracker" ON public.sharp_line_tracker
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Anyone can view sharp lines
CREATE POLICY "Anyone can view sharp lines" ON public.sharp_line_tracker
  FOR SELECT USING (true);

-- Create index for performance
CREATE INDEX idx_sharp_line_tracker_sport ON public.sharp_line_tracker(sport);
CREATE INDEX idx_sharp_line_tracker_status ON public.sharp_line_tracker(status);
CREATE INDEX idx_sharp_line_tracker_created ON public.sharp_line_tracker(created_at DESC);