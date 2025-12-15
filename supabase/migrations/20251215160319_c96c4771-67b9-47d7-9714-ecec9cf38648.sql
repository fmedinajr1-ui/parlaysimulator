-- Phase 1: MedianLock™ PRO Data Models

-- 1.1 Extend nba_player_game_logs with additional columns
ALTER TABLE public.nba_player_game_logs 
ADD COLUMN IF NOT EXISTS field_goals_attempted INTEGER,
ADD COLUMN IF NOT EXISTS usage_rate NUMERIC,
ADD COLUMN IF NOT EXISTS is_starter BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS teammates_out JSONB DEFAULT '[]'::jsonb;

-- 1.2 Create median_lock_candidates table
CREATE TABLE public.median_lock_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  team_name TEXT,
  prop_type TEXT NOT NULL,
  book_line NUMERIC NOT NULL,
  current_price INTEGER,
  opening_price INTEGER,
  location TEXT, -- 'HOME' or 'AWAY'
  opponent TEXT,
  opponent_defense_rank INTEGER,
  event_id TEXT,
  slate_date DATE NOT NULL,
  
  -- Last 10 game arrays
  points_last_10 JSONB DEFAULT '[]'::jsonb,
  minutes_last_10 JSONB DEFAULT '[]'::jsonb,
  usage_last_10 JSONB DEFAULT '[]'::jsonb,
  shots_last_10 JSONB DEFAULT '[]'::jsonb,
  home_away_last_10 JSONB DEFAULT '[]'::jsonb,
  
  -- Medians (Last 10)
  median_points NUMERIC,
  median_minutes NUMERIC,
  median_usage NUMERIC,
  median_shots NUMERIC,
  
  -- Edge Calculations
  raw_edge NUMERIC,
  defense_adjustment NUMERIC,
  adjusted_edge NUMERIC,
  split_edge NUMERIC,
  juice_lag_bonus NUMERIC DEFAULT 0,
  
  -- Hit Rate
  hit_rate NUMERIC,
  hit_rate_last_5 NUMERIC,
  
  -- Shock Detection
  is_shock_flagged BOOLEAN DEFAULT false,
  shock_reasons JSONB DEFAULT '[]'::jsonb,
  minutes_shock BOOLEAN DEFAULT false,
  usage_shock BOOLEAN DEFAULT false,
  shots_shock BOOLEAN DEFAULT false,
  teammates_out_count INTEGER DEFAULT 0,
  shock_passed_validation BOOLEAN,
  
  -- Scoring
  consistency_score NUMERIC,
  confidence_score NUMERIC,
  classification TEXT CHECK (classification IN ('LOCK', 'STRONG', 'BLOCK')),
  block_reason TEXT,
  
  -- Diagnostics
  passed_checks JSONB DEFAULT '[]'::jsonb,
  failed_checks JSONB DEFAULT '[]'::jsonb,
  
  -- Outcome (for backtesting)
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('hit', 'miss', 'push', 'pending')),
  actual_value NUMERIC,
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.3 Create median_lock_slips table (Green Slips)
CREATE TABLE public.median_lock_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slate_date DATE NOT NULL,
  slip_type TEXT NOT NULL CHECK (slip_type IN ('2-leg', '3-leg')),
  
  -- Leg references
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  leg_ids UUID[] DEFAULT '{}',
  
  -- Scoring
  slip_score NUMERIC,
  probability NUMERIC,
  stake_tier TEXT CHECK (stake_tier IN ('A', 'B', 'C')),
  
  -- Outcome
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('won', 'lost', 'push', 'pending')),
  legs_hit INTEGER DEFAULT 0,
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1.4 Create median_lock_backtest_results table
CREATE TABLE public.median_lock_backtest_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date TIMESTAMPTZ DEFAULT NOW(),
  slates_analyzed INTEGER,
  
  -- Leg-level metrics
  lock_only_hit_rate NUMERIC,
  lock_strong_hit_rate NUMERIC,
  lock_count INTEGER,
  strong_count INTEGER,
  block_count INTEGER,
  
  -- Slip-level metrics
  slip_2_hit_rate NUMERIC,
  slip_3_hit_rate NUMERIC,
  slip_2_count INTEGER,
  slip_3_count INTEGER,
  
  -- Diagnostics
  top_fail_reasons JSONB DEFAULT '[]'::jsonb,
  avg_edge NUMERIC,
  avg_minutes NUMERIC,
  avg_confidence_score NUMERIC,
  juice_lag_win_rate NUMERIC,
  shock_flag_rate NUMERIC,
  shock_pass_rate NUMERIC,
  
  -- Breakdown by category
  defense_bucket_stats JSONB DEFAULT '{}'::jsonb,
  home_away_stats JSONB DEFAULT '{}'::jsonb,
  minutes_bucket_stats JSONB DEFAULT '{}'::jsonb,
  
  -- Tuned thresholds (from auto-tuning)
  tuned_edge_min NUMERIC,
  tuned_hit_rate_min NUMERIC,
  tuned_minutes_floor NUMERIC,
  
  -- Parameters used
  parameters JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_median_lock_candidates_slate ON public.median_lock_candidates(slate_date);
CREATE INDEX idx_median_lock_candidates_classification ON public.median_lock_candidates(classification);
CREATE INDEX idx_median_lock_candidates_outcome ON public.median_lock_candidates(outcome);
CREATE INDEX idx_median_lock_slips_slate ON public.median_lock_slips(slate_date);
CREATE INDEX idx_median_lock_slips_outcome ON public.median_lock_slips(outcome);

-- Enable RLS
ALTER TABLE public.median_lock_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.median_lock_slips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.median_lock_backtest_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Public read access
CREATE POLICY "Anyone can view median lock candidates" ON public.median_lock_candidates FOR SELECT USING (true);
CREATE POLICY "Anyone can view median lock slips" ON public.median_lock_slips FOR SELECT USING (true);
CREATE POLICY "Anyone can view median lock backtest results" ON public.median_lock_backtest_results FOR SELECT USING (true);