-- Add outcome tracking columns to hitrate_parlays
ALTER TABLE public.hitrate_parlays 
ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS result_details jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS actual_win_rate numeric;

-- Create hitrate accuracy tracking table
CREATE TABLE IF NOT EXISTS public.hitrate_accuracy_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_type text NOT NULL,
  sport text,
  prop_type text,
  total_parlays integer NOT NULL DEFAULT 0,
  total_won integer NOT NULL DEFAULT 0,
  total_lost integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  avg_predicted_probability numeric NOT NULL DEFAULT 0,
  avg_actual_probability numeric NOT NULL DEFAULT 0,
  calibration_factor numeric NOT NULL DEFAULT 1.0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(strategy_type, sport, prop_type)
);

-- Enable RLS
ALTER TABLE public.hitrate_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view accuracy metrics
CREATE POLICY "Anyone can view hitrate accuracy metrics" 
ON public.hitrate_accuracy_metrics 
FOR SELECT 
USING (true);

-- Create function to get hitrate accuracy stats
CREATE OR REPLACE FUNCTION public.get_hitrate_accuracy_stats()
RETURNS TABLE(
  strategy_type text,
  sport text,
  total_parlays integer,
  total_won integer,
  total_lost integer,
  win_rate numeric,
  predicted_vs_actual numeric,
  calibration_needed text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hp.strategy_type,
    hp.sport,
    COUNT(*)::integer as total_parlays,
    COUNT(*) FILTER (WHERE hp.outcome = 'won')::integer as total_won,
    COUNT(*) FILTER (WHERE hp.outcome = 'lost')::integer as total_lost,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE hp.outcome = 'won')::numeric / 
           COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')) * 100, 1)
      ELSE 0
    END as win_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')) > 0 
      THEN ROUND(AVG(hp.combined_probability) * 100 - 
           (COUNT(*) FILTER (WHERE hp.outcome = 'won')::numeric / 
            COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')) * 100), 1)
      ELSE 0
    END as predicted_vs_actual,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')) < 10 THEN 'insufficient_data'
      WHEN COUNT(*) FILTER (WHERE hp.outcome = 'won')::numeric / 
           NULLIF(COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')), 0) > 
           AVG(hp.combined_probability) + 0.1 THEN 'underconfident'
      WHEN COUNT(*) FILTER (WHERE hp.outcome = 'won')::numeric / 
           NULLIF(COUNT(*) FILTER (WHERE hp.outcome IN ('won', 'lost')), 0) < 
           AVG(hp.combined_probability) - 0.1 THEN 'overconfident'
      ELSE 'calibrated'
    END as calibration_needed
  FROM hitrate_parlays hp
  WHERE hp.outcome IS NOT NULL
  GROUP BY hp.strategy_type, hp.sport
  ORDER BY total_parlays DESC;
END;
$$;

-- Create function to get hitrate prop type accuracy
CREATE OR REPLACE FUNCTION public.get_hitrate_prop_accuracy()
RETURNS TABLE(
  prop_type text,
  total_legs integer,
  won_legs integer,
  lost_legs integer,
  leg_win_rate numeric,
  avg_hit_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH leg_outcomes AS (
    SELECT 
      leg->>'prop_type' as prop_type,
      leg->>'hit_rate' as hit_rate,
      CASE 
        WHEN hp.outcome = 'won' THEN true
        WHEN hp.outcome = 'lost' THEN false
        ELSE NULL
      END as parlay_won
    FROM hitrate_parlays hp,
    jsonb_array_elements(hp.legs) as leg
    WHERE hp.outcome IN ('won', 'lost')
  )
  SELECT 
    lo.prop_type,
    COUNT(*)::integer as total_legs,
    COUNT(*) FILTER (WHERE lo.parlay_won = true)::integer as won_legs,
    COUNT(*) FILTER (WHERE lo.parlay_won = false)::integer as lost_legs,
    ROUND(COUNT(*) FILTER (WHERE lo.parlay_won = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as leg_win_rate,
    ROUND(AVG(lo.hit_rate::numeric), 1) as avg_hit_rate
  FROM leg_outcomes lo
  WHERE lo.prop_type IS NOT NULL
  GROUP BY lo.prop_type
  ORDER BY total_legs DESC;
END;
$$;