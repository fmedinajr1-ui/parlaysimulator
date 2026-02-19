ALTER TABLE public.sweet_spot_hedge_snapshots
  ADD COLUMN IF NOT EXISTS actual_final numeric,
  ADD COLUMN IF NOT EXISTS outcome text;