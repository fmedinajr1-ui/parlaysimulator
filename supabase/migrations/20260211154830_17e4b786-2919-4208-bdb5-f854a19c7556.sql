
-- API Budget Tracker table for smart rate limiting
CREATE TABLE public.api_budget_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  calls_used INTEGER NOT NULL DEFAULT 0,
  calls_limit INTEGER NOT NULL DEFAULT 2500,
  last_full_scrape TIMESTAMPTZ,
  last_scout TIMESTAMPTZ,
  last_targeted TIMESTAMPTZ,
  warning_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_budget_tracker ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role key)
CREATE POLICY "Service role full access on api_budget_tracker"
ON public.api_budget_tracker
FOR ALL
USING (true)
WITH CHECK (true);

-- Function to increment API calls atomically
CREATE OR REPLACE FUNCTION public.increment_api_calls(p_date DATE, p_count INTEGER DEFAULT 1)
RETURNS TABLE(new_total INTEGER, daily_limit INTEGER, is_over_limit BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calls INTEGER;
  v_limit INTEGER;
BEGIN
  INSERT INTO api_budget_tracker (date, calls_used, calls_limit)
  VALUES (p_date, p_count, 2500)
  ON CONFLICT (date) DO UPDATE SET calls_used = api_budget_tracker.calls_used + p_count
  RETURNING api_budget_tracker.calls_used, api_budget_tracker.calls_limit
  INTO v_calls, v_limit;

  new_total := v_calls;
  daily_limit := v_limit;
  is_over_limit := v_calls >= v_limit;
  RETURN NEXT;
END;
$$;
