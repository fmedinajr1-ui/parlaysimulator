-- BUG E FIX: is_gated column so gated records are excluded from accuracy queries
ALTER TABLE fanduel_prediction_accuracy
  ADD COLUMN IF NOT EXISTS is_gated boolean DEFAULT false;

-- Backfill: all pre-existing rows were not gated
UPDATE fanduel_prediction_accuracy
SET is_gated = false
WHERE is_gated IS NULL;

-- BUG B FIX: add settlement_method if not already present
ALTER TABLE fanduel_prediction_accuracy
  ADD COLUMN IF NOT EXISTS settlement_method text;

-- BUG I FIX: store pitcher L10 hit rate for dashboards
ALTER TABLE fanduel_prediction_accuracy
  ADD COLUMN IF NOT EXISTS pitcher_l10_hit_rate numeric(4,3);

-- Index: most queries filter WHERE is_gated = false
CREATE INDEX IF NOT EXISTS idx_fpa_not_gated
  ON fanduel_prediction_accuracy (signal_type, prop_type, was_correct)
  WHERE is_gated = false
    AND actual_outcome != 'informational_excluded';

-- Combined index for filtering out excluded rows efficiently
DROP INDEX IF EXISTS idx_fpa_prop_sport;
CREATE INDEX IF NOT EXISTS idx_fpa_prop_sport_clean
  ON fanduel_prediction_accuracy (prop_type, sport, was_correct, settlement_method)
  WHERE is_gated = false
    AND actual_outcome != 'informational_excluded'
    AND was_correct IS NOT NULL;