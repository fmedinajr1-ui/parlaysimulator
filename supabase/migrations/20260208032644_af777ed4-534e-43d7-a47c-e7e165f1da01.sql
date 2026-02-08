-- Bot daily parlays table - stores generated parlays with full traceability
CREATE TABLE public.bot_daily_parlays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  parlay_date date NOT NULL DEFAULT CURRENT_DATE,
  
  -- Parlay Details
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  leg_count int NOT NULL DEFAULT 0,
  combined_probability numeric NOT NULL DEFAULT 0,
  expected_odds int NOT NULL DEFAULT 0,
  simulated_win_rate numeric,
  simulated_edge numeric,
  simulated_sharpe numeric,
  
  -- Strategy Used
  strategy_name text NOT NULL,
  strategy_version int DEFAULT 1,
  category_weights_snapshot jsonb,
  selection_rationale text,
  
  -- Outcome Tracking  
  outcome text DEFAULT 'pending' CHECK (outcome IN ('pending', 'won', 'lost', 'partial', 'push')),
  legs_hit int DEFAULT 0,
  legs_missed int DEFAULT 0,
  settled_at timestamptz,
  
  -- Learning Feedback
  profit_loss numeric,
  lesson_learned text,
  
  -- Mode Tracking
  is_simulated boolean DEFAULT true,
  simulated_stake numeric DEFAULT 50,
  simulated_payout numeric
);

-- Bot category weights - dynamic weights that adjust based on outcomes
CREATE TABLE public.bot_category_weights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text UNIQUE NOT NULL,
  side text NOT NULL DEFAULT 'under',
  
  -- Performance Metrics
  total_picks int DEFAULT 0,
  total_hits int DEFAULT 0,
  current_hit_rate numeric DEFAULT 0,
  
  -- Dynamic Weight (0-1.5 range)
  weight numeric DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1.5),
  is_blocked boolean DEFAULT false,
  block_reason text,
  
  -- Streaks
  current_streak int DEFAULT 0,
  best_streak int DEFAULT 0,
  worst_streak int DEFAULT 0,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Bot strategies - versioned strategy rules with performance tracking
CREATE TABLE public.bot_strategies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  
  -- Strategy Rules
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  
  -- Performance
  times_used int DEFAULT 0,
  times_won int DEFAULT 0,
  win_rate numeric DEFAULT 0,
  roi numeric DEFAULT 0,
  
  -- Status
  is_active boolean DEFAULT true,
  retired_at timestamptz,
  retire_reason text,
  
  -- Auto-evolution
  auto_generated boolean DEFAULT false,
  parent_strategy text,
  version int DEFAULT 1,
  
  updated_at timestamptz DEFAULT now()
);

-- Bot activation status - track readiness for real betting
CREATE TABLE public.bot_activation_status (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  check_date date UNIQUE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Daily Performance
  parlays_generated int DEFAULT 0,
  parlays_won int DEFAULT 0,
  parlays_lost int DEFAULT 0,
  daily_profit_loss numeric DEFAULT 0,
  is_profitable_day boolean DEFAULT false,
  
  -- Streak Tracking
  consecutive_profitable_days int DEFAULT 0,
  
  -- Activation Status
  is_real_mode_ready boolean DEFAULT false,
  activated_at timestamptz,
  
  -- Bankroll
  simulated_bankroll numeric DEFAULT 1000,
  real_bankroll numeric DEFAULT 0,
  
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on all bot tables
ALTER TABLE public.bot_daily_parlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_category_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_activation_status ENABLE ROW LEVEL SECURITY;

-- Public read policies (bot data is public for viewing)
CREATE POLICY "Anyone can view bot parlays" ON public.bot_daily_parlays FOR SELECT USING (true);
CREATE POLICY "Anyone can view category weights" ON public.bot_category_weights FOR SELECT USING (true);
CREATE POLICY "Anyone can view strategies" ON public.bot_strategies FOR SELECT USING (true);
CREATE POLICY "Anyone can view activation status" ON public.bot_activation_status FOR SELECT USING (true);

-- Service role policies for edge functions to modify
CREATE POLICY "Service role can manage bot parlays" ON public.bot_daily_parlays FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage category weights" ON public.bot_category_weights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage strategies" ON public.bot_strategies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage activation status" ON public.bot_activation_status FOR ALL USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_bot_parlays_date ON public.bot_daily_parlays(parlay_date);
CREATE INDEX idx_bot_parlays_outcome ON public.bot_daily_parlays(outcome);
CREATE INDEX idx_bot_weights_category ON public.bot_category_weights(category);
CREATE INDEX idx_bot_strategies_active ON public.bot_strategies(is_active);
CREATE INDEX idx_bot_activation_date ON public.bot_activation_status(check_date);

-- Trigger to update updated_at
CREATE TRIGGER update_bot_category_weights_updated_at
  BEFORE UPDATE ON public.bot_category_weights
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bot_strategies_updated_at
  BEFORE UPDATE ON public.bot_strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default strategy
INSERT INTO public.bot_strategies (strategy_name, description, rules, is_active)
VALUES (
  'elite_categories_v1',
  'Uses proven 60%+ categories with MC simulation validation',
  '{"min_hit_rate": 0.55, "min_weight": 0.8, "min_sim_win_rate": 0.12, "min_edge": 0.03, "min_sharpe": 0.5, "max_legs": 6, "iterations": 25000}'::jsonb,
  true
);

-- Insert initial category weights based on proven performance
INSERT INTO public.bot_category_weights (category, side, weight, current_hit_rate, is_blocked) VALUES
  ('HIGH_ASSIST_UNDER', 'under', 1.2, 69.2, false),
  ('LOW_SCORER_UNDER', 'under', 1.15, 66.0, false),
  ('THREE_POINT_SHOOTER', 'over', 1.1, 63.2, false),
  ('BIG_ASSIST_OVER', 'over', 1.0, 59.0, false),
  ('ROLE_PLAYER_REB', 'over', 0.4, 48.2, true),
  ('HIGH_ASSIST_OVER', 'over', 0.0, 33.3, true)
ON CONFLICT (category) DO NOTHING;