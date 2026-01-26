-- Create RPC function to get category hit rates for dynamic performance guards
CREATE OR REPLACE FUNCTION public.get_category_hit_rates()
RETURNS TABLE (
  category TEXT,
  hits BIGINT,
  misses BIGINT,
  pushes BIGINT,
  total_settled BIGINT,
  hit_rate NUMERIC
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    css.category,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss') as misses,
    COUNT(*) FILTER (WHERE css.outcome = 'push') as pushes,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push')) as total_settled,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
    1) as hit_rate
  FROM category_sweet_spots css
  WHERE css.outcome IS NOT NULL
  GROUP BY css.category
  HAVING COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) > 0
  ORDER BY hit_rate DESC;
END;
$$;