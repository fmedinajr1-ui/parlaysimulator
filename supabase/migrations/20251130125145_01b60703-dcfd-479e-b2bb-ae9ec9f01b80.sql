-- Create function to get betting time patterns for a user
CREATE OR REPLACE FUNCTION public.get_betting_time_patterns(p_user_id uuid)
RETURNS TABLE(
  month integer,
  day_of_week integer,
  total_bets bigint,
  wins bigint,
  win_rate numeric,
  avg_odds numeric,
  upset_wins bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    EXTRACT(MONTH FROM ptd.created_at)::integer as month,
    EXTRACT(DOW FROM ptd.created_at)::integer as day_of_week,
    COUNT(*) as total_bets,
    COUNT(*) FILTER (WHERE ptd.parlay_outcome = true) as wins,
    ROUND(
      CASE 
        WHEN COUNT(*) > 0 
        THEN COUNT(*) FILTER (WHERE ptd.parlay_outcome = true)::numeric / COUNT(*) * 100 
        ELSE 0 
      END, 1
    ) as win_rate,
    ROUND(AVG(ptd.odds), 0) as avg_odds,
    COUNT(*) FILTER (WHERE ptd.parlay_outcome = true AND ptd.odds > 150) as upset_wins
  FROM parlay_training_data ptd
  WHERE ptd.user_id = p_user_id
    AND ptd.parlay_outcome IS NOT NULL
  GROUP BY 
    EXTRACT(MONTH FROM ptd.created_at),
    EXTRACT(DOW FROM ptd.created_at);
END;
$$;