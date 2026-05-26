CREATE TABLE public.scout_speed_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  coefficients jsonb NOT NULL,
  training_window_start timestamptz,
  training_window_end timestamptz,
  n_samples integer NOT NULL DEFAULT 0,
  log_loss numeric,
  brier numeric,
  mse_move numeric,
  active boolean NOT NULL DEFAULT false,
  fit_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX scout_speed_models_version_uidx ON public.scout_speed_models (version);
CREATE UNIQUE INDEX scout_speed_models_one_active ON public.scout_speed_models (active) WHERE active = true;
CREATE INDEX scout_speed_models_fit_at_idx ON public.scout_speed_models (fit_at DESC);

GRANT SELECT ON public.scout_speed_models TO authenticated;
GRANT ALL ON public.scout_speed_models TO service_role;

ALTER TABLE public.scout_speed_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read scout_speed_models"
  ON public.scout_speed_models
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));