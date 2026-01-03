-- A/B Testing Framework for Parlay Strategies

-- Main experiments table
CREATE TABLE parlay_ab_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  experiment_name TEXT NOT NULL,
  description TEXT,
  hypothesis TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  
  start_date DATE NOT NULL,
  end_date DATE,
  min_sample_size INTEGER DEFAULT 30,
  
  control_config JSONB NOT NULL,
  variant_config JSONB NOT NULL,
  test_variables JSONB,
  
  control_parlays_total INTEGER DEFAULT 0,
  control_parlays_won INTEGER DEFAULT 0,
  control_legs_hit_avg NUMERIC,
  variant_parlays_total INTEGER DEFAULT 0,
  variant_parlays_won INTEGER DEFAULT 0,
  variant_legs_hit_avg NUMERIC,
  
  statistical_significance NUMERIC,
  confidence_interval JSONB,
  winner TEXT CHECK (winner IN ('control', 'variant', 'inconclusive', NULL)),
  lift_percentage NUMERIC,
  
  completed_at TIMESTAMPTZ,
  conclusion TEXT
);

-- Individual parlay assignments to experiments
CREATE TABLE parlay_experiment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  experiment_id UUID REFERENCES parlay_ab_experiments(id) ON DELETE CASCADE,
  parlay_id UUID NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('control', 'variant')),
  
  parlay_type TEXT,
  config_snapshot JSONB,
  confidence_at_creation NUMERIC,
  total_edge_at_creation NUMERIC,
  duo_stacks_count INTEGER,
  
  outcome TEXT DEFAULT 'pending' CHECK (outcome IN ('pending', 'won', 'lost', 'partial', 'push')),
  legs_hit INTEGER,
  legs_total INTEGER DEFAULT 6,
  verified_at TIMESTAMPTZ
);

-- Granular metrics per experiment per day
CREATE TABLE parlay_experiment_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID REFERENCES parlay_ab_experiments(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('control', 'variant')),
  
  parlays_generated INTEGER DEFAULT 0,
  parlays_won INTEGER DEFAULT 0,
  parlays_lost INTEGER DEFAULT 0,
  
  avg_confidence NUMERIC,
  avg_edge NUMERIC,
  avg_legs_hit NUMERIC,
  
  cumulative_win_rate NUMERIC,
  
  UNIQUE(experiment_id, metric_date, variant)
);

-- Indexes for performance
CREATE INDEX idx_ab_experiments_status ON parlay_ab_experiments(status);
CREATE INDEX idx_ab_assignments_experiment ON parlay_experiment_assignments(experiment_id);
CREATE INDEX idx_ab_assignments_parlay ON parlay_experiment_assignments(parlay_id);
CREATE INDEX idx_ab_assignments_outcome ON parlay_experiment_assignments(outcome);
CREATE INDEX idx_ab_daily_metrics_experiment ON parlay_experiment_daily_metrics(experiment_id);

-- RLS policies
ALTER TABLE parlay_ab_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for ab_experiments" ON parlay_ab_experiments FOR SELECT USING (true);
CREATE POLICY "Service role write for ab_experiments" ON parlay_ab_experiments FOR ALL USING (true);

ALTER TABLE parlay_experiment_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for assignments" ON parlay_experiment_assignments FOR SELECT USING (true);
CREATE POLICY "Service role write for assignments" ON parlay_experiment_assignments FOR ALL USING (true);

ALTER TABLE parlay_experiment_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for daily_metrics" ON parlay_experiment_daily_metrics FOR SELECT USING (true);
CREATE POLICY "Service role write for daily_metrics" ON parlay_experiment_daily_metrics FOR ALL USING (true);