
-- Create table for hourly FanDuel trap analysis
CREATE TABLE public.fanduel_trap_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_round INTEGER NOT NULL DEFAULT 1,
  scan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  description TEXT,
  player_name TEXT,
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  
  -- Opening to current tracking
  opening_price NUMERIC,
  current_price NUMERIC,
  total_movement NUMERIC DEFAULT 0,
  movement_direction TEXT,
  
  -- Trap indicators
  trap_score NUMERIC DEFAULT 0,
  is_public_bait BOOLEAN DEFAULT false,
  public_bait_reason TEXT,
  opposite_side_also_moved BOOLEAN DEFAULT false,
  price_only_move BOOLEAN DEFAULT false,
  
  -- Hourly tracking
  hourly_movements JSONB DEFAULT '[]'::jsonb,
  movement_count INTEGER DEFAULT 0,
  
  -- For parlay building
  recommended_side TEXT,
  fade_the_public_pick TEXT,
  confidence_score NUMERIC DEFAULT 0,
  odds_for_fade NUMERIC,
  
  -- Metadata
  commence_time TIMESTAMPTZ,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(scan_date, event_id, outcome_name, market_type)
);

-- Create table for daily FanDuel parlay
CREATE TABLE public.fanduel_daily_parlay (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_date DATE NOT NULL UNIQUE,
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_odds NUMERIC NOT NULL DEFAULT 0,
  target_odds INTEGER DEFAULT 1000,
  confidence_score NUMERIC DEFAULT 0,
  reasoning_summary TEXT,
  movement_analysis JSONB DEFAULT '{}'::jsonb,
  
  -- Progress tracking
  scans_completed INTEGER DEFAULT 0,
  total_movements_analyzed INTEGER DEFAULT 0,
  trap_patterns_found INTEGER DEFAULT 0,
  
  -- Outcome tracking
  outcome TEXT DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.fanduel_trap_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanduel_daily_parlay ENABLE ROW LEVEL SECURITY;

-- RLS policies - anyone can view
CREATE POLICY "Anyone can view trap analysis" ON public.fanduel_trap_analysis FOR SELECT USING (true);
CREATE POLICY "Anyone can view daily parlay" ON public.fanduel_daily_parlay FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX idx_fanduel_trap_scan_date ON public.fanduel_trap_analysis(scan_date);
CREATE INDEX idx_fanduel_trap_score ON public.fanduel_trap_analysis(trap_score DESC);
CREATE INDEX idx_fanduel_parlay_date ON public.fanduel_daily_parlay(parlay_date);
