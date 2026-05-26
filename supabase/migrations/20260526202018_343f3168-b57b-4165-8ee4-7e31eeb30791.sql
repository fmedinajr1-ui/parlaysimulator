
ALTER TABLE public.court_edge_picks
  ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppressed_reason text;

CREATE INDEX IF NOT EXISTS court_edge_picks_suppressed_idx
  ON public.court_edge_picks (suppressed, commence_at DESC)
  WHERE suppressed = true;

-- Bias audit view: one row per (dimension, bucket), with sample size,
-- mean residual (projection - actual_total_games), and win rate.
-- Includes suppressed picks so STRONG_OVER residuals stay visible.
CREATE OR REPLACE VIEW public.projection_bias_audit
WITH (security_invoker = true)
AS
WITH base AS (
  SELECT
    p.id,
    p.verdict,
    p.surface,
    p.sets_format,
    p.tournament,
    p.line,
    p.projection,
    p.edge_pct,
    p.actual_total_games,
    p.result,
    p.suppressed,
    -- role combo
    CASE
      WHEN p.role_adj_home IS NULL OR p.role_adj_away IS NULL THEN 'unknown'
      WHEN p.role_adj_home > 0 AND p.role_adj_away <= 0 THEN 'home_fav'
      WHEN p.role_adj_home <= 0 AND p.role_adj_away > 0 THEN 'away_fav'
      WHEN p.role_adj_home > 0 AND p.role_adj_away > 0 THEN 'both_fav'
      ELSE 'both_dog'
    END AS role_combo,
    -- edge band
    CASE
      WHEN abs(p.edge_pct) >= 15 THEN '15%+'
      WHEN abs(p.edge_pct) >= 10 THEN '10-15%'
      WHEN abs(p.edge_pct) >= 7  THEN '7-10%'
      ELSE '<7%'
    END AS edge_band,
    -- tournament tier (mirrors UI helper)
    CASE
      WHEN p.tournament IS NULL THEN 'unknown'
      WHEN p.tournament ~* 'roland|wimbledon|us open|australian|melbourne|flushing' THEN 'grand_slam'
      WHEN p.tournament ~* 'madrid|miami|indian wells|cincinnati|rome|monte carlo|shanghai|paris masters|toronto|montreal|masters 1000|wta 1000' THEN 'masters_1000'
      WHEN p.tournament ~* 'atp 500|wta 500|dubai|barcelona|vienna|basel|rotterdam|queens|halle|hamburg|tokyo|beijing|doha' THEN '500'
      WHEN p.tournament ~* 'challenger|atp 125|atp 100|atp 75' THEN 'challenger'
      WHEN p.tournament ~* 'itf|m15|m25|w15|w25|w35|w50|w60|w75|w100' THEN 'itf'
      ELSE '250/other'
    END AS tier,
    (p.projection - p.actual_total_games)::numeric AS residual
  FROM public.court_edge_picks p
  WHERE p.graded = true
    AND p.result IN ('WIN','LOSS')
    AND p.actual_total_games IS NOT NULL
    AND p.verdict IN ('STRONG_OVER','STRONG_UNDER','LEAN_OVER','LEAN_UNDER')
),
unioned AS (
  SELECT 'verdict'   AS dimension, verdict     AS bucket, residual, result FROM base
  UNION ALL
  SELECT 'surface',   COALESCE(surface,'unknown'),       residual, result FROM base
  UNION ALL
  SELECT 'sets_format', COALESCE(sets_format,'unknown'), residual, result FROM base
  UNION ALL
  SELECT 'role_combo', role_combo,                      residual, result FROM base
  UNION ALL
  SELECT 'edge_band',  edge_band,                       residual, result FROM base
  UNION ALL
  SELECT 'tier',       tier,                            residual, result FROM base
)
SELECT
  dimension,
  bucket,
  count(*)::int                                                    AS n,
  round(avg(residual)::numeric, 3)                                 AS mean_residual,
  round((sum(CASE WHEN result='WIN' THEN 1 ELSE 0 END)::numeric
         / NULLIF(count(*),0)) * 100, 1)                           AS win_rate
FROM unioned
GROUP BY dimension, bucket
ORDER BY dimension, abs(avg(residual)) DESC NULLS LAST;

GRANT SELECT ON public.projection_bias_audit TO authenticated, service_role;
