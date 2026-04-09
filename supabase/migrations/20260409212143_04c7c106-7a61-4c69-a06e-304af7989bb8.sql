ALTER TABLE high_conviction_results
  ADD COLUMN IF NOT EXISTS engine_count int,
  ADD COLUMN IF NOT EXISTS agreement_ratio int,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'high_conviction_results_date_player_prop_key'
  ) THEN
    ALTER TABLE high_conviction_results
      ADD CONSTRAINT high_conviction_results_date_player_prop_key
      UNIQUE (analysis_date, player_name, prop_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hcr_date_score
  ON high_conviction_results (analysis_date, conviction_score DESC);

CREATE INDEX IF NOT EXISTS idx_fpa_prop_sport
  ON fanduel_prediction_accuracy (prop_type, sport)
  WHERE was_correct IS NOT NULL
    AND actual_outcome != 'informational_excluded';