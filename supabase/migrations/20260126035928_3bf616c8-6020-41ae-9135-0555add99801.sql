-- Table 1: Backtest run metadata
CREATE TABLE backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_name TEXT,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  builder_version TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Aggregated results
  total_slates INT DEFAULT 0,
  total_parlays_built INT DEFAULT 0,
  total_legs INT DEFAULT 0,
  legs_hit INT DEFAULT 0,
  legs_missed INT DEFAULT 0,
  legs_pushed INT DEFAULT 0,
  leg_hit_rate NUMERIC(5,4),
  parlay_win_rate NUMERIC(5,4),
  
  -- v6.0 specific metrics
  avg_synergy_score NUMERIC(5,2),
  avg_edge_value NUMERIC(5,2),
  picks_blocked_by_edge INT DEFAULT 0,
  picks_blocked_by_synergy INT DEFAULT 0,
  
  -- Comparison
  baseline_run_id UUID REFERENCES backtest_runs(id),
  improvement_vs_baseline NUMERIC(5,2),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Table 2: Per-slate parlay results
CREATE TABLE backtest_parlay_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES backtest_runs(id) ON DELETE CASCADE,
  slate_date DATE NOT NULL,
  parlay_type TEXT NOT NULL,
  
  -- Leg details with outcomes
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  leg_count INT,
  legs_hit INT,
  legs_missed INT,
  legs_pushed INT,
  all_legs_hit BOOLEAN,
  
  -- v6.0 synergy metrics
  total_synergy_score NUMERIC(5,2),
  conflicts_detected INT DEFAULT 0,
  edge_blocked_count INT DEFAULT 0,
  avg_edge_value NUMERIC(5,2),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_parlay_results ENABLE ROW LEVEL SECURITY;

-- Public read access for backtest results (admin tool)
CREATE POLICY "Public read access for backtest_runs"
  ON backtest_runs FOR SELECT
  USING (true);

CREATE POLICY "Public read access for backtest_parlay_results"
  ON backtest_parlay_results FOR SELECT
  USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can manage backtest_runs"
  ON backtest_runs FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage backtest_parlay_results"
  ON backtest_parlay_results FOR ALL
  USING (true)
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_backtest_runs_version ON backtest_runs(builder_version);
CREATE INDEX idx_backtest_runs_dates ON backtest_runs(date_range_start, date_range_end);
CREATE INDEX idx_backtest_parlay_results_run ON backtest_parlay_results(run_id);
CREATE INDEX idx_backtest_parlay_results_date ON backtest_parlay_results(slate_date);