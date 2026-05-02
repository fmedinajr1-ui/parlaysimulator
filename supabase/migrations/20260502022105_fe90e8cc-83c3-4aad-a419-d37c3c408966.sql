-- Drop any existing duplicates first (keep newest per group)
DELETE FROM public.mlb_rbi_under_analysis a
USING public.mlb_rbi_under_analysis b
WHERE a.id < b.id
  AND a.player_name = b.player_name
  AND a.analysis_date = b.analysis_date
  AND a.variant IS NOT DISTINCT FROM b.variant;

CREATE UNIQUE INDEX IF NOT EXISTS mlb_rbi_under_analysis_player_date_variant_uniq
  ON public.mlb_rbi_under_analysis (player_name, analysis_date, variant)
  WHERE variant IS NOT NULL;