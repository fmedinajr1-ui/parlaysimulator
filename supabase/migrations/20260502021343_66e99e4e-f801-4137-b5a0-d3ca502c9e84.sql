-- mlb_rbi_under_analysis: tracking columns
ALTER TABLE public.mlb_rbi_under_analysis
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS line numeric,
  ADD COLUMN IF NOT EXISTS p_under numeric,
  ADD COLUMN IF NOT EXISTS edge numeric,
  ADD COLUMN IF NOT EXISTS expected_rbi numeric,
  ADD COLUMN IF NOT EXISTS l3_rbis numeric,
  ADD COLUMN IF NOT EXISTS l3_rbis_per_pa numeric,
  ADD COLUMN IF NOT EXISTS lineup_spot integer,
  ADD COLUMN IF NOT EXISTS park text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS result text DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS actual_rbis integer,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_rbi_under_date_variant_tier
  ON public.mlb_rbi_under_analysis (analysis_date, variant, tier);
CREATE INDEX IF NOT EXISTS idx_rbi_under_result
  ON public.mlb_rbi_under_analysis (result, analysis_date);

-- mlb_engine_picks: settlement columns
ALTER TABLE public.mlb_engine_picks
  ADD COLUMN IF NOT EXISTS result text DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_engine_picks_prop_side_result
  ON public.mlb_engine_picks (prop_type, side, result);

-- Per-variant accuracy view
CREATE OR REPLACE VIEW public.mlb_rbi_under_variant_accuracy AS
SELECT
  variant,
  COUNT(*) FILTER (WHERE result IN ('WIN','LOSS')) AS settled_picks,
  COUNT(*) FILTER (WHERE result = 'WIN')           AS wins,
  COUNT(*) FILTER (WHERE result = 'LOSS')          AS losses,
  COUNT(*) FILTER (WHERE result = 'VOID')          AS voids,
  COUNT(*) FILTER (WHERE result = 'PENDING')       AS pending,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE result = 'WIN')
    / NULLIF(COUNT(*) FILTER (WHERE result IN ('WIN','LOSS')), 0)
  , 1) AS win_rate_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE result = 'WIN' AND analysis_date >= (CURRENT_DATE - INTERVAL '7 days'))
    / NULLIF(COUNT(*) FILTER (WHERE result IN ('WIN','LOSS') AND analysis_date >= (CURRENT_DATE - INTERVAL '7 days')), 0)
  , 1) AS win_rate_7d_pct
FROM public.mlb_rbi_under_analysis
WHERE variant IS NOT NULL
GROUP BY variant
ORDER BY variant;