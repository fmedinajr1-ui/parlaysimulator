-- 1. model_team_elo
CREATE TABLE public.model_team_elo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  team TEXT NOT NULL,
  rating NUMERIC NOT NULL DEFAULT 1500,
  games_played INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, team)
);
CREATE INDEX idx_model_team_elo_sport ON public.model_team_elo(sport);

-- 2. model_totals_params
CREATE TABLE public.model_totals_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  team TEXT NOT NULL,
  attack NUMERIC NOT NULL DEFAULT 1.0,
  defense NUMERIC NOT NULL DEFAULT 1.0,
  home_adv NUMERIC NOT NULL DEFAULT 0.15,
  games_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, team)
);
CREATE INDEX idx_model_totals_params_sport ON public.model_totals_params(sport);

-- 3. model_prop_artifacts
CREATE TABLE public.model_prop_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  model_blob JSONB NOT NULL,
  feature_spec JSONB NOT NULL,
  calibration JSONB,
  sample_size INTEGER NOT NULL DEFAULT 0,
  trained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, prop_type)
);

-- 4. model_predictions (today's slate)
CREATE TABLE public.model_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  game_date_et DATE NOT NULL,
  event_id TEXT,
  player_name TEXT,
  model TEXT NOT NULL,           -- 'elo' | 'poisson' | 'xgb_prop'
  market_type TEXT NOT NULL,     -- 'h2h' | 'spread' | 'total' | 'player_prop'
  prop_type TEXT,
  side TEXT NOT NULL,            -- 'home'/'away'/'over'/'under'
  current_line NUMERIC,
  prob NUMERIC NOT NULL,
  edge_pct NUMERIC NOT NULL,
  game_description TEXT,
  has_real_line BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_model_predictions_date ON public.model_predictions(game_date_et, sport);
CREATE INDEX idx_model_predictions_model ON public.model_predictions(model, edge_pct DESC);

-- 5. model_intel_results
CREATE TABLE public.model_intel_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES public.model_predictions(id) ON DELETE SET NULL,
  sport TEXT NOT NULL,
  game_date_et DATE NOT NULL,
  model TEXT NOT NULL,
  market_type TEXT NOT NULL,
  side TEXT,
  current_line NUMERIC,
  prob NUMERIC,
  edge_pct NUMERIC,
  result TEXT NOT NULL,          -- 'win' | 'loss' | 'push' | 'void'
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_model_intel_results_date ON public.model_intel_results(game_date_et, model);

-- 6. model_intel_telegram_log
CREATE TABLE public.model_intel_telegram_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date_et DATE NOT NULL,
  channel TEXT NOT NULL DEFAULT 'ai_models_intelligence',
  message_text TEXT,
  predictions_included INTEGER NOT NULL DEFAULT 0,
  telegram_message_id BIGINT,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (date_et, channel)
);

-- RLS
ALTER TABLE public.model_team_elo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_totals_params ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_prop_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_intel_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_intel_telegram_log ENABLE ROW LEVEL SECURITY;

-- Read policies (authenticated users can read predictions + results for UI)
CREATE POLICY "auth read predictions" ON public.model_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read intel results" ON public.model_intel_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read elo" ON public.model_team_elo FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read totals params" ON public.model_totals_params FOR SELECT TO authenticated USING (true);

-- Service role implicit bypass; no insert/update/delete policies = locked to service role.