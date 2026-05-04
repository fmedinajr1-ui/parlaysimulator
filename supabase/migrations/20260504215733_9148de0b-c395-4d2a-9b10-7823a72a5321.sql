ALTER TABLE public.court_edge_config
  ADD COLUMN IF NOT EXISTS near_prior_band_sigmas numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS near_prior_clamp_sigmas numeric NOT NULL DEFAULT 1.0;

UPDATE public.court_edge_config
SET edge_hard_cap_pp = 0.18,
    near_prior_band_sigmas = 1.5,
    near_prior_clamp_sigmas = 1.0,
    updated_at = now()
WHERE id = 'default';