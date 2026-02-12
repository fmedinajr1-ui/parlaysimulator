
-- 1. Add tier column to bot_daily_parlays
ALTER TABLE bot_daily_parlays 
  ADD COLUMN IF NOT EXISTS tier text DEFAULT 'execution';

-- 2. Backfill tier from strategy_name
UPDATE bot_daily_parlays SET tier = 'exploration' 
  WHERE strategy_name LIKE '%exploration%';
UPDATE bot_daily_parlays SET tier = 'validation' 
  WHERE strategy_name LIKE '%validation%';

-- 3. Create bot_learning_metrics table
CREATE TABLE bot_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  tier text NOT NULL DEFAULT 'execution',
  total_generated integer DEFAULT 0,
  total_settled integer DEFAULT 0,
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  sample_sufficiency numeric DEFAULT 0,
  ci_lower numeric DEFAULT 0,
  ci_upper numeric DEFAULT 0,
  days_to_convergence integer DEFAULT 999,
  created_at timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, tier)
);

-- 4. RLS policy - public read access
ALTER TABLE bot_learning_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access" ON bot_learning_metrics
  FOR SELECT USING (true);
