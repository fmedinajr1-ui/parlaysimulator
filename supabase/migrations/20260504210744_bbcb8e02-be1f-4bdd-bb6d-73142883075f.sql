CREATE TABLE public.court_edge_config (
  id text PRIMARY KEY DEFAULT 'default',
  shrink_k numeric NOT NULL DEFAULT 4,
  blowout_cutoff_bo3 numeric NOT NULL DEFAULT 14,
  blowout_cutoff_bo5 numeric NOT NULL DEFAULT 22,
  blowout_penalty numeric NOT NULL DEFAULT 0.5,
  sanity_sigmas numeric NOT NULL DEFAULT 3,
  spread_v2_max_penalty numeric NOT NULL DEFAULT 3.0,
  spread_v2_coinflip_bias numeric NOT NULL DEFAULT 0.6,
  spread_v2_coinflip_threshold numeric NOT NULL DEFAULT 0.10,
  spread_v2_max_bias numeric NOT NULL DEFAULT 0.8,
  edge_hard_cap_pp numeric NOT NULL DEFAULT 0.12,
  strong_pp numeric NOT NULL DEFAULT 0.04,
  lean_pp numeric NOT NULL DEFAULT 0.02,
  line_band_sigmas numeric NOT NULL DEFAULT 2.5,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.court_edge_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "court_edge_config readable by authenticated"
  ON public.court_edge_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "court_edge_config admin update"
  ON public.court_edge_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "court_edge_config admin insert"
  ON public.court_edge_config FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.court_edge_config (id) VALUES ('default')
  ON CONFLICT (id) DO NOTHING;