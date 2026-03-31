
ALTER TABLE public.fanduel_prediction_accuracy
  ADD COLUMN IF NOT EXISTS line_at_alert numeric,
  ADD COLUMN IF NOT EXISTS closing_line numeric,
  ADD COLUMN IF NOT EXISTS line_movement_after_alert numeric,
  ADD COLUMN IF NOT EXISTS movement_reversed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversal_magnitude numeric,
  ADD COLUMN IF NOT EXISTS was_trap boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS trap_type text,
  ADD COLUMN IF NOT EXISTS hours_before_tip numeric,
  ADD COLUMN IF NOT EXISTS alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS snapshots_at_alert integer,
  ADD COLUMN IF NOT EXISTS drift_pct_at_alert numeric,
  ADD COLUMN IF NOT EXISTS post_alert_snapshots integer;
