
-- soccer_sharp_lines: Pinnacle (sharp) snapshots
CREATE TABLE public.soccer_sharp_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  league TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ,
  market_type TEXT NOT NULL,         -- 'moneyline' | 'asian_handicap' | 'totals' | 'team_total_home' | 'team_total_away'
  line NUMERIC,                      -- handicap or total; null for ML
  side_a_label TEXT NOT NULL,        -- e.g. home / over / fav
  side_b_label TEXT NOT NULL,
  pinnacle_price_a INTEGER NOT NULL, -- American odds
  pinnacle_price_b INTEGER NOT NULL,
  sharp_probability_a NUMERIC NOT NULL,
  sharp_probability_b NUMERIC NOT NULL,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ssl_match_market ON public.soccer_sharp_lines(match_id, market_type, line, created_at DESC);
CREATE INDEX idx_ssl_created ON public.soccer_sharp_lines(created_at DESC);

GRANT SELECT ON public.soccer_sharp_lines TO authenticated;
GRANT ALL ON public.soccer_sharp_lines TO service_role;
ALTER TABLE public.soccer_sharp_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssl_read_auth" ON public.soccer_sharp_lines FOR SELECT TO authenticated USING (true);

-- soccer_book_comparisons: per book vs Pinnacle
CREATE TABLE public.soccer_book_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sharp_line_id UUID REFERENCES public.soccer_sharp_lines(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  sportsbook TEXT NOT NULL,          -- 'hardrock' | 'draftkings' | 'fanduel' | 'caesars' | 'betmgm'
  market_type TEXT NOT NULL,
  line NUMERIC,
  side TEXT NOT NULL,                -- 'a' | 'b'
  sportsbook_price INTEGER NOT NULL,
  sportsbook_probability NUMERIC NOT NULL,
  sharp_probability NUMERIC NOT NULL,
  edge_percent NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sbc_match ON public.soccer_book_comparisons(match_id, created_at DESC);
CREATE INDEX idx_sbc_edge ON public.soccer_book_comparisons(edge_percent DESC, created_at DESC);

GRANT SELECT ON public.soccer_book_comparisons TO authenticated;
GRANT ALL ON public.soccer_book_comparisons TO service_role;
ALTER TABLE public.soccer_book_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sbc_read_auth" ON public.soccer_book_comparisons FOR SELECT TO authenticated USING (true);

-- soccer_sharp_alerts: fired alerts
CREATE TABLE public.soccer_sharp_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  league TEXT,
  market TEXT NOT NULL,
  line NUMERIC,
  sportsbook TEXT NOT NULL,
  recommended_side TEXT NOT NULL,
  sharp_probability NUMERIC NOT NULL,
  sportsbook_probability NUMERIC NOT NULL,
  edge_percent NUMERIC NOT NULL,
  chess_score NUMERIC NOT NULL,
  classification TEXT NOT NULL,       -- 'LEAN' | 'STRONG' | 'HAMMER' | 'STEAM'
  expected_value NUMERIC,
  confidence NUMERIC,
  risk_flags JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',-- 'open' | 'closed' | 'expired'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ssa_status_created ON public.soccer_sharp_alerts(status, created_at DESC);
CREATE INDEX idx_ssa_classification ON public.soccer_sharp_alerts(classification, created_at DESC);

GRANT SELECT ON public.soccer_sharp_alerts TO authenticated;
GRANT ALL ON public.soccer_sharp_alerts TO service_role;
ALTER TABLE public.soccer_sharp_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssa_read_auth" ON public.soccer_sharp_alerts FOR SELECT TO authenticated USING (true);

-- soccer_line_movements: opening + previous + current per book/market
CREATE TABLE public.soccer_line_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL,
  sportsbook TEXT NOT NULL,           -- 'pinnacle' | book name
  market_type TEXT NOT NULL,
  side TEXT NOT NULL,
  opening_line NUMERIC,
  opening_price INTEGER,
  opening_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_line NUMERIC,
  previous_price INTEGER,
  previous_at TIMESTAMPTZ,
  current_line NUMERIC,
  current_price INTEGER,
  current_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  movement_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(match_id, sportsbook, market_type, side)
);
CREATE INDEX idx_slm_match ON public.soccer_line_movements(match_id, sportsbook, market_type);

GRANT SELECT ON public.soccer_line_movements TO authenticated;
GRANT ALL ON public.soccer_line_movements TO service_role;
ALTER TABLE public.soccer_line_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slm_read_auth" ON public.soccer_line_movements FOR SELECT TO authenticated USING (true);

-- updated_at trigger helper (idempotent)
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER ssa_set_updated_at BEFORE UPDATE ON public.soccer_sharp_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER slm_set_updated_at BEFORE UPDATE ON public.soccer_line_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
