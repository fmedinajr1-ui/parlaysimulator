
-- Create simulation_shadow_picks table
CREATE TABLE public.simulation_shadow_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  event_id TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  side TEXT NOT NULL,
  predicted_score FLOAT NOT NULL,
  line FLOAT,
  odds INT,
  outcome TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  scoring_version TEXT NOT NULL DEFAULT 'v1',
  score_breakdown JSONB,
  home_team TEXT,
  away_team TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create simulation_accuracy table
CREATE TABLE public.simulation_accuracy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  scoring_version TEXT NOT NULL DEFAULT 'v1',
  predictions_made INT NOT NULL DEFAULT 0,
  predictions_correct INT NOT NULL DEFAULT 0,
  accuracy_rate FLOAT NOT NULL DEFAULT 0,
  avg_composite_score FLOAT NOT NULL DEFAULT 0,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_production_ready BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sport, bet_type, scoring_version, period_start, period_end)
);

-- Enable RLS
ALTER TABLE public.simulation_shadow_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_accuracy ENABLE ROW LEVEL SECURITY;

-- Service role access policies
CREATE POLICY "Service role full access on shadow picks"
  ON public.simulation_shadow_picks FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on simulation accuracy"
  ON public.simulation_accuracy FOR ALL
  USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_shadow_picks_sport_outcome ON public.simulation_shadow_picks(sport, outcome);
CREATE INDEX idx_shadow_picks_event ON public.simulation_shadow_picks(event_id);
CREATE INDEX idx_shadow_picks_created ON public.simulation_shadow_picks(created_at DESC);
CREATE INDEX idx_sim_accuracy_sport ON public.simulation_accuracy(sport, bet_type, is_production_ready);
