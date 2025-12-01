-- Create function to get strategy-specific performance stats
CREATE OR REPLACE FUNCTION public.get_strategy_performance_stats(p_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  strategy_type text,
  total_followed integer,
  total_won integer,
  total_lost integer,
  total_pending integer,
  win_rate numeric,
  total_staked numeric,
  total_profit numeric,
  avg_odds numeric,
  roi_percentage numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN sugp.suggestion_reason ILIKE '%fade%' THEN 'fade'
      WHEN sugp.suggestion_reason ILIKE '%verified%sharp%' OR sugp.suggestion_reason ILIKE '%high-confidence%real%sharp%' THEN 'verified_sharp'
      WHEN sugp.suggestion_reason ILIKE '%sharp%' THEN 'sharp_props'
      ELSE 'other'
    END as strategy_type,
    COUNT(*)::integer as total_followed,
    COUNT(*) FILTER (WHERE sp.outcome = true)::integer as total_won,
    COUNT(*) FILTER (WHERE sp.outcome = false)::integer as total_lost,
    COUNT(*) FILTER (WHERE sp.outcome IS NULL)::integer as total_pending,
    CASE 
      WHEN COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE sp.outcome = true)::numeric / COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) * 100, 1)
      ELSE 0
    END as win_rate,
    COALESCE(SUM(sp.stake), 0) as total_staked,
    COALESCE(SUM(
      CASE 
        WHEN sp.outcome = true THEN COALESCE(sp.payout, 0) - sp.stake 
        WHEN sp.outcome = false THEN -sp.stake 
        ELSE 0 
      END
    ), 0) as total_profit,
    ROUND(AVG(sugp.total_odds), 0) as avg_odds,
    CASE 
      WHEN SUM(sp.stake) > 0 
      THEN ROUND(
        (SUM(CASE WHEN sp.outcome = true THEN COALESCE(sp.payout, 0) - sp.stake WHEN sp.outcome = false THEN -sp.stake ELSE 0 END) / SUM(sp.stake)) * 100, 
        1
      )
      ELSE 0
    END as roi_percentage
  FROM suggestion_performance sp
  JOIN suggested_parlays sugp ON sp.suggested_parlay_id = sugp.id
  WHERE (p_user_id IS NULL OR sp.user_id = p_user_id)
  GROUP BY 
    CASE 
      WHEN sugp.suggestion_reason ILIKE '%fade%' THEN 'fade'
      WHEN sugp.suggestion_reason ILIKE '%verified%sharp%' OR sugp.suggestion_reason ILIKE '%high-confidence%real%sharp%' THEN 'verified_sharp'
      WHEN sugp.suggestion_reason ILIKE '%sharp%' THEN 'sharp_props'
      ELSE 'other'
    END
  ORDER BY total_followed DESC;
END;
$$;