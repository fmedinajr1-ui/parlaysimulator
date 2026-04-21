-- Leads table for free slip uploads / email capture
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  source text NOT NULL DEFAULT 'free_slip_upload',
  slip_text text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_can_insert_lead"
  ON public.leads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "no_public_select_leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (false);

-- Sharp Tracker public-facing seeded signals
CREATE TABLE IF NOT EXISTS public.sharp_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text NOT NULL,
  matchup text NOT NULL,
  pick text NOT NULL,
  sharp_pct integer NOT NULL CHECK (sharp_pct BETWEEN 0 AND 100),
  public_pct integer NOT NULL CHECK (public_pct BETWEEN 0 AND 100),
  line_movement text,
  hit_rate text,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sharp_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_sharp_signals"
  ON public.sharp_signals FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
