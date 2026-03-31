ALTER TABLE public.fanduel_prediction_accuracy
ADD COLUMN IF NOT EXISTS line_changes_after_alert integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS line_trajectory jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS recommendation_status text DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS recommendation_updated_at timestamptz;