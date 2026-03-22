CREATE TABLE public.pick_score_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_name text NOT NULL UNIQUE,
  weight numeric NOT NULL DEFAULT 0,
  avg_when_hit numeric,
  avg_when_miss numeric,
  separation numeric,
  sample_size integer DEFAULT 0,
  calibrated_at timestamptz DEFAULT now()
);

ALTER TABLE public.pick_score_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on pick_score_weights"
  ON public.pick_score_weights FOR SELECT
  TO anon, authenticated
  USING (true);