-- Create a function to get leaderboard stats (bypasses RLS safely for aggregation)
CREATE OR REPLACE FUNCTION public.get_leaderboard_stats(time_period text DEFAULT 'all')
RETURNS TABLE (
  user_id uuid,
  username text,
  avatar_url text,
  lifetime_degenerate_score numeric,
  total_staked numeric,
  total_wins integer,
  total_losses integer,
  total_parlays bigint,
  period_staked numeric,
  period_parlays bigint,
  avg_probability numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_date timestamp with time zone;
BEGIN
  -- Calculate start date based on period
  IF time_period = 'weekly' THEN
    start_date := now() - interval '7 days';
  ELSIF time_period = 'monthly' THEN
    start_date := now() - interval '30 days';
  ELSE
    start_date := '1970-01-01'::timestamp with time zone;
  END IF;

  RETURN QUERY
  SELECT 
    p.user_id,
    p.username,
    p.avatar_url,
    p.lifetime_degenerate_score,
    p.total_staked,
    p.total_wins,
    p.total_losses,
    COALESCE(stats.total_parlays, 0) as total_parlays,
    COALESCE(stats.period_staked, 0) as period_staked,
    COALESCE(stats.period_parlays, 0) as period_parlays,
    COALESCE(stats.avg_probability, 0) as avg_probability
  FROM profiles p
  LEFT JOIN (
    SELECT 
      ph.user_id,
      COUNT(*) as total_parlays,
      SUM(CASE WHEN ph.created_at >= start_date THEN ph.stake ELSE 0 END) as period_staked,
      COUNT(CASE WHEN ph.created_at >= start_date THEN 1 END) as period_parlays,
      AVG(CASE WHEN ph.created_at >= start_date THEN ph.combined_probability END) as avg_probability
    FROM parlay_history ph
    GROUP BY ph.user_id
  ) stats ON p.user_id = stats.user_id
  WHERE p.username IS NOT NULL
  ORDER BY 
    CASE 
      WHEN time_period = 'all' THEN p.lifetime_degenerate_score
      ELSE COALESCE(stats.period_staked, 0)
    END DESC
  LIMIT 100;
END;
$$;