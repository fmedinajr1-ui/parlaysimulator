ALTER TABLE public.high_conviction_results ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'pending';
ALTER TABLE public.high_conviction_results ADD COLUMN IF NOT EXISTS actual_value numeric;
ALTER TABLE public.high_conviction_results ADD COLUMN IF NOT EXISTS settled_at timestamptz;