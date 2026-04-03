
CREATE OR REPLACE FUNCTION public.get_parlay_accuracy_dashboard(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  section TEXT,
  label TEXT,
  total_parlays BIGINT,
  wins BIGINT,
  losses BIGINT,
  voids BIGINT,
  win_rate NUMERIC,
  miss_by_1 BIGINT,
  miss_by_1_pct NUMERIC,
  avg_legs NUMERIC,
  net_profit NUMERIC,
  sample_confidence TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Overall
  RETURN QUERY
  SELECT 'overall'::TEXT, 'All Parlays'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'won')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'lost')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'void')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'won')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')),0) * 100, 1),
    COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome = 'lost'),0) * 100, 1),
    ROUND(AVG(p.leg_count)::NUMERIC, 1),
    COALESCE(SUM(p.profit_loss), 0)::NUMERIC,
    CASE WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 100 THEN 'high'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 50 THEN 'medium'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 20 THEN 'low'
         ELSE 'insufficient' END::TEXT
  FROM bot_daily_parlays p
  WHERE p.parlay_date >= CURRENT_DATE - days_back;

  -- By tier
  RETURN QUERY
  SELECT 'tier'::TEXT, COALESCE(p.tier, 'unknown')::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'won')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'lost')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'void')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'won')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')),0) * 100, 1),
    COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome = 'lost'),0) * 100, 1),
    ROUND(AVG(p.leg_count)::NUMERIC, 1),
    COALESCE(SUM(p.profit_loss), 0)::NUMERIC,
    CASE WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 100 THEN 'high'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 50 THEN 'medium'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 20 THEN 'low'
         ELSE 'insufficient' END::TEXT
  FROM bot_daily_parlays p
  WHERE p.parlay_date >= CURRENT_DATE - days_back
  GROUP BY p.tier;

  -- By leg count
  RETURN QUERY
  SELECT 'leg_count'::TEXT, (p.leg_count || '-leg')::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'won')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'lost')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'void')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'won')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')),0) * 100, 1),
    COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome = 'lost'),0) * 100, 1),
    ROUND(AVG(p.leg_count)::NUMERIC, 1),
    COALESCE(SUM(p.profit_loss), 0)::NUMERIC,
    CASE WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 100 THEN 'high'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 50 THEN 'medium'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 20 THEN 'low'
         ELSE 'insufficient' END::TEXT
  FROM bot_daily_parlays p
  WHERE p.parlay_date >= CURRENT_DATE - days_back
  GROUP BY p.leg_count;

  -- Top strategies (settled only)
  RETURN QUERY
  SELECT 'strategy'::TEXT, p.strategy_name::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'won')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'lost')::BIGINT,
    COUNT(*) FILTER (WHERE p.outcome = 'void')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'won')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')),0) * 100, 1),
    COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE p.outcome = 'lost' AND p.legs_missed = 1)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome = 'lost'),0) * 100, 1),
    ROUND(AVG(p.leg_count)::NUMERIC, 1),
    COALESCE(SUM(p.profit_loss), 0)::NUMERIC,
    CASE WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 100 THEN 'high'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 50 THEN 'medium'
         WHEN COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')) >= 20 THEN 'low'
         ELSE 'insufficient' END::TEXT
  FROM bot_daily_parlays p
  WHERE p.parlay_date >= CURRENT_DATE - days_back
    AND p.outcome IN ('won','lost')
  GROUP BY p.strategy_name
  HAVING COUNT(*) >= 5
  ORDER BY ROUND(COUNT(*) FILTER (WHERE p.outcome = 'won')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE p.outcome IN ('won','lost')),0) * 100, 1) DESC NULLS LAST;
END;
$$;
