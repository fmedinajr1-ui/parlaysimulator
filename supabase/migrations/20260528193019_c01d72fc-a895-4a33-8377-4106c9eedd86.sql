CREATE TABLE public.court_edge_player_fit (
  player_slug TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('clay','hard','grass')),
  fit NUMERIC(4,3) NOT NULL CHECK (fit >= 0 AND fit <= 1),
  fit_n INT NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_slug, surface)
);

GRANT SELECT ON public.court_edge_player_fit TO authenticated;
GRANT ALL ON public.court_edge_player_fit TO service_role;

ALTER TABLE public.court_edge_player_fit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "court_edge_player_fit readable"
ON public.court_edge_player_fit FOR SELECT
TO authenticated
USING (true);

ALTER TABLE public.court_edge_picks ADD COLUMN IF NOT EXISTS v3_shadow JSONB;

CREATE OR REPLACE VIEW public.court_edge_v3_audit AS
SELECT
  p.id,
  p.run_id,
  p.market,
  p.line,
  p.commence_at,
  p.actual_total_games,
  p.result,
  p.projection         AS live_projection,
  p.edge_pct           AS live_edge_pct,
  p.verdict            AS live_verdict,
  p.suppressed         AS live_suppressed,
  (p.v3_shadow->>'projection')::numeric AS v3_projection,
  (p.v3_shadow->>'edge_pct')::numeric   AS v3_edge_pct,
  (p.v3_shadow->>'verdict')             AS v3_verdict,
  (p.v3_shadow->>'pass_reason')         AS v3_pass_reason,
  (p.v3_shadow->>'sets_format')         AS v3_sets_format,
  (p.actual_total_games - p.projection)                              AS live_residual,
  (p.actual_total_games - (p.v3_shadow->>'projection')::numeric)     AS v3_residual,
  (CASE
     WHEN p.verdict IN ('STRONG_OVER','LEAN_OVER')   AND p.v3_shadow->>'verdict' = 'BACK_OVER' THEN true
     WHEN p.verdict IN ('STRONG_UNDER','LEAN_UNDER') AND p.v3_shadow->>'verdict' = 'FADE_OVER' THEN true
     WHEN p.verdict = 'PASS'                          AND p.v3_shadow->>'verdict' = 'PASS'      THEN true
     ELSE false
   END) AS verdict_agreement
FROM public.court_edge_picks p
WHERE p.v3_shadow IS NOT NULL AND p.graded = true;

GRANT SELECT ON public.court_edge_v3_audit TO authenticated;
GRANT SELECT ON public.court_edge_v3_audit TO service_role;