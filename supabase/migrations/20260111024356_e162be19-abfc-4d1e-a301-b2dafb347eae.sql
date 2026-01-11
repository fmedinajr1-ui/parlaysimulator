-- Create prop_results_archive table - permanent storage of all settled picks
CREATE TABLE public.prop_results_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Source tracking
  engine TEXT NOT NULL, -- 'risk', 'sharp', 'heat', 'prop_v2'
  source_id UUID, -- Original ID from source table
  
  -- Date/Time
  game_date DATE NOT NULL,
  game_month DATE, -- First day of month for easy grouping
  created_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  
  -- Pick details
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  team_name TEXT,
  opponent TEXT,
  sport TEXT DEFAULT 'NBA',
  
  -- Outcome
  outcome TEXT, -- 'hit', 'miss', 'push', 'pending'
  actual_value NUMERIC,
  
  -- Context/Scoring
  confidence_score NUMERIC,
  edge NUMERIC,
  signal_label TEXT,
  reason TEXT,
  
  -- For parlays
  is_parlay BOOLEAN DEFAULT FALSE,
  parlay_type TEXT, -- 'CORE', 'UPSIDE', 'SAFE', 'BALANCED'
  parlay_legs JSONB,
  
  -- Metadata
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_prop_archive_game_date ON public.prop_results_archive(game_date);
CREATE INDEX idx_prop_archive_engine ON public.prop_results_archive(engine);
CREATE INDEX idx_prop_archive_outcome ON public.prop_results_archive(outcome);
CREATE INDEX idx_prop_archive_month ON public.prop_results_archive(game_month);
CREATE INDEX idx_prop_archive_source ON public.prop_results_archive(engine, source_id);

-- Create monthly_accuracy_snapshot table - aggregated monthly stats
CREATE TABLE public.monthly_accuracy_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month_year DATE NOT NULL, -- First day of month (e.g., 2026-01-01)
  engine TEXT NOT NULL,
  sport TEXT DEFAULT 'NBA',
  
  -- Counts
  total_picks INTEGER DEFAULT 0,
  total_hits INTEGER DEFAULT 0,
  total_misses INTEGER DEFAULT 0,
  total_pushes INTEGER DEFAULT 0,
  
  -- Rates
  hit_rate NUMERIC,
  
  -- Breakdown by prop type
  prop_type_breakdown JSONB DEFAULT '{}',
  
  -- Breakdown by signal
  signal_breakdown JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(month_year, engine, sport)
);

CREATE INDEX idx_monthly_snapshot_month ON public.monthly_accuracy_snapshot(month_year);
CREATE INDEX idx_monthly_snapshot_engine ON public.monthly_accuracy_snapshot(engine);

-- Enable RLS
ALTER TABLE public.prop_results_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_accuracy_snapshot ENABLE ROW LEVEL SECURITY;

-- Public read access (these are analytics tables)
CREATE POLICY "Anyone can view prop archive" ON public.prop_results_archive FOR SELECT USING (true);
CREATE POLICY "Anyone can view monthly snapshots" ON public.monthly_accuracy_snapshot FOR SELECT USING (true);

-- Service role can insert/update/delete
CREATE POLICY "Service can manage prop archive" ON public.prop_results_archive FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage monthly snapshots" ON public.monthly_accuracy_snapshot FOR ALL USING (true) WITH CHECK (true);