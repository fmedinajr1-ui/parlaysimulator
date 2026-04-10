
-- Tennis Match Model table
CREATE TABLE IF NOT EXISTS public.tennis_match_model (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  player_a TEXT NOT NULL,
  player_b TEXT NOT NULL,
  tour TEXT NOT NULL CHECK (tour IN ('ATP', 'WTA')),
  surface TEXT,
  pp_total_games_line NUMERIC,
  projected_total_games NUMERIC,
  recommended_side TEXT CHECK (recommended_side IN ('over', 'under')),
  edge_pct NUMERIC,
  gender_modifier NUMERIC DEFAULT 0,
  surface_modifier NUMERIC DEFAULT 0,
  player_a_avg_games_l10 NUMERIC,
  player_b_avg_games_l10 NUMERIC,
  h2h_avg_total_games NUMERIC,
  h2h_sample_size INTEGER DEFAULT 0,
  confidence_score NUMERIC,
  outcome TEXT CHECK (outcome IN ('hit', 'miss', 'push', NULL)),
  actual_total_games NUMERIC,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_match_model_unique 
  ON public.tennis_match_model (analysis_date, player_a, player_b, tour);

CREATE INDEX IF NOT EXISTS idx_tennis_match_model_date ON public.tennis_match_model (analysis_date);
CREATE INDEX IF NOT EXISTS idx_tennis_match_model_tour ON public.tennis_match_model (tour);

ALTER TABLE public.tennis_match_model ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tennis_match_model' AND policyname = 'Service role full access on tennis_match_model'
  ) THEN
    CREATE POLICY "Service role full access on tennis_match_model"
      ON public.tennis_match_model FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Ensure tennis_player_stats has RLS and trigger
ALTER TABLE public.tennis_player_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'tennis_player_stats' AND policyname = 'Service role full access on tennis_player_stats'
  ) THEN
    CREATE POLICY "Service role full access on tennis_player_stats"
      ON public.tennis_player_stats FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers (drop first to be idempotent)
DROP TRIGGER IF EXISTS update_tennis_match_model_updated_at ON public.tennis_match_model;
CREATE TRIGGER update_tennis_match_model_updated_at
  BEFORE UPDATE ON public.tennis_match_model
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tennis_player_stats_updated_at ON public.tennis_player_stats;
CREATE TRIGGER update_tennis_player_stats_updated_at
  BEFORE UPDATE ON public.tennis_player_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
