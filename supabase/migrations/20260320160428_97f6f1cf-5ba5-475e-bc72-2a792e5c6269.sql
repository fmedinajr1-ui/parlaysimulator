
CREATE OR REPLACE FUNCTION get_straight_bet_performance(days_back integer DEFAULT 30)
RETURNS TABLE (
  prop_type text,
  side text,
  total_bets bigint,
  wins bigint,
  losses bigint,
  win_rate numeric,
  total_staked numeric,
  total_profit numeric,
  roi_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.prop_type,
    b.side,
    COUNT(*)::bigint AS total_bets,
    COUNT(*) FILTER (WHERE b.outcome = 'won')::bigint AS wins,
    COUNT(*) FILTER (WHERE b.outcome = 'lost')::bigint AS losses,
    ROUND(COUNT(*) FILTER (WHERE b.outcome = 'won')::numeric / NULLIF(COUNT(*) FILTER (WHERE b.outcome IN ('won','lost')), 0) * 100, 1) AS win_rate,
    COALESCE(SUM(b.simulated_stake), 0) AS total_staked,
    COALESCE(SUM(b.profit_loss), 0) AS total_profit,
    ROUND(COALESCE(SUM(b.profit_loss), 0) / NULLIF(SUM(b.simulated_stake), 0) * 100, 1) AS roi_pct
  FROM bot_straight_bets b
  WHERE b.bet_date >= (CURRENT_DATE - days_back)
    AND b.outcome IN ('won', 'lost')
  GROUP BY b.prop_type, b.side
  ORDER BY win_rate DESC NULLS LAST;
$$;
