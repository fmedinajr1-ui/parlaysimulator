-- Create ai_formula_auto_bans table for tracking auto-banned formulas
CREATE TABLE public.ai_formula_auto_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_name text NOT NULL,
  engine_source text NOT NULL,
  ban_reason text NOT NULL DEFAULT 'low_accuracy_streak',
  accuracy_at_ban numeric,
  total_picks integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  lifted_at timestamptz,
  UNIQUE(formula_name, engine_source)
);

-- Enable RLS
ALTER TABLE public.ai_formula_auto_bans ENABLE ROW LEVEL SECURITY;

-- Public read policy (for transparency)
CREATE POLICY "Anyone can view auto bans"
  ON public.ai_formula_auto_bans FOR SELECT USING (true);

-- Admin management policy
CREATE POLICY "Admins can manage auto bans"
  ON public.ai_formula_auto_bans FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));