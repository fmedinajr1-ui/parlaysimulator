
-- Snapshot table: stores every scan run as a timestamped row
CREATE TABLE public.mispriced_line_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  prop_type text NOT NULL,
  sport text NOT NULL DEFAULT 'basketball_nba',
  book_line numeric NOT NULL,
  over_price numeric,
  under_price numeric,
  edge_pct numeric NOT NULL DEFAULT 0,
  signal text NOT NULL DEFAULT 'OVER',
  confidence_tier text NOT NULL DEFAULT 'LOW',
  shooting_context jsonb,
  scan_time timestamptz NOT NULL DEFAULT now(),
  analysis_date date NOT NULL DEFAULT CURRENT_DATE
);

CREATE INDEX idx_mispriced_snapshots_date ON public.mispriced_line_snapshots (analysis_date);
CREATE INDEX idx_mispriced_snapshots_player ON public.mispriced_line_snapshots (player_name, prop_type, analysis_date);

-- Verdicts table: pre-game final assessment
CREATE TABLE public.mispriced_line_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name text NOT NULL,
  prop_type text NOT NULL,
  sport text NOT NULL DEFAULT 'basketball_nba',
  analysis_date date NOT NULL DEFAULT CURRENT_DATE,
  first_scan_line numeric,
  first_scan_price numeric,
  final_scan_line numeric,
  final_scan_price numeric,
  price_movement numeric,
  line_movement numeric,
  whale_signal text NOT NULL DEFAULT 'NONE',
  verdict text NOT NULL DEFAULT 'HOLD',
  verdict_reason text,
  commence_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_name, prop_type, analysis_date, sport)
);

CREATE INDEX idx_mispriced_verdicts_date ON public.mispriced_line_verdicts (analysis_date);
