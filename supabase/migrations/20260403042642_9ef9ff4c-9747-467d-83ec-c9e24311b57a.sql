CREATE TABLE public.final_verdict_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_date DATE NOT NULL DEFAULT CURRENT_DATE,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'over',
  line NUMERIC,
  sport TEXT,
  verdict_grade TEXT NOT NULL CHECK (verdict_grade IN ('DIAMOND','GOLD','SILVER')),
  consensus_score INTEGER NOT NULL DEFAULT 0,
  fanduel_signal_type TEXT,
  fanduel_accuracy NUMERIC,
  high_conviction_match BOOLEAN DEFAULT false,
  line_projection_agrees BOOLEAN DEFAULT false,
  category_weight NUMERIC,
  category_blocked BOOLEAN DEFAULT false,
  line_drift_ok BOOLEAN DEFAULT true,
  engines_agreeing TEXT[] DEFAULT '{}',
  engine_details JSONB DEFAULT '{}',
  used_in_parlay BOOLEAN DEFAULT false,
  outcome TEXT DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_final_verdict_date ON public.final_verdict_picks (verdict_date);
CREATE INDEX idx_final_verdict_grade ON public.final_verdict_picks (verdict_grade);

ALTER TABLE public.final_verdict_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read final verdict picks" ON public.final_verdict_picks FOR SELECT USING (true);