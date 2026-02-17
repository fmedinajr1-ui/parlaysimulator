
-- Create bot_adaptation_state table
CREATE TABLE public.bot_adaptation_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adaptation_date date NOT NULL,
  current_regime text NOT NULL DEFAULT 'full_slate',
  regime_confidence numeric DEFAULT 50,
  regime_weights jsonb DEFAULT '{}'::jsonb,
  correlation_matrix jsonb DEFAULT '[]'::jsonb,
  tier_recommendations jsonb DEFAULT '{}'::jsonb,
  gate_overrides jsonb DEFAULT '{}'::jsonb,
  adaptation_score numeric DEFAULT 50,
  modules_run jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create unique index on adaptation_date for upsert
CREATE UNIQUE INDEX idx_bot_adaptation_state_date ON public.bot_adaptation_state (adaptation_date);

-- Enable RLS
ALTER TABLE public.bot_adaptation_state ENABLE ROW LEVEL SECURITY;

-- Public read policy (bot data is non-sensitive)
CREATE POLICY "Anyone can read adaptation state"
  ON public.bot_adaptation_state FOR SELECT USING (true);

-- Service role insert/update (edge functions use service role key)
CREATE POLICY "Service role can manage adaptation state"
  ON public.bot_adaptation_state FOR ALL
  USING (true) WITH CHECK (true);

-- Add 3 new columns to bot_category_weights
ALTER TABLE public.bot_category_weights
  ADD COLUMN IF NOT EXISTS recency_hit_rate numeric,
  ADD COLUMN IF NOT EXISTS bayesian_hit_rate numeric,
  ADD COLUMN IF NOT EXISTS regime_multiplier numeric DEFAULT 1.0;
