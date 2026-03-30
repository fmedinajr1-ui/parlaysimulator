
-- Delete duplicate rows, keeping only the earliest entry per unique combo
DELETE FROM fanduel_prediction_accuracy
WHERE id NOT IN (
  SELECT DISTINCT ON (event_id, player_name, prop_type, signal_type) id
  FROM fanduel_prediction_accuracy
  ORDER BY event_id, player_name, prop_type, signal_type, created_at ASC
);

-- Add a unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_fanduel_pred_acc_dedup 
ON fanduel_prediction_accuracy (event_id, player_name, prop_type, signal_type);
