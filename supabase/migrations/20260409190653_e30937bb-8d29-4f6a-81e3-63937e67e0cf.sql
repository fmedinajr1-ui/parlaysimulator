
CREATE OR REPLACE FUNCTION public.get_rbi_accuracy_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  overall jsonb;
  by_signal jsonb;
  by_side jsonb;
  by_confidence jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_settled', COUNT(*) FILTER (WHERE was_correct IS NOT NULL),
    'total_correct', COUNT(*) FILTER (WHERE was_correct = true),
    'total_incorrect', COUNT(*) FILTER (WHERE was_correct = false),
    'win_rate', ROUND(
      COUNT(*) FILTER (WHERE was_correct = true)::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE was_correct IS NOT NULL), 0) * 100, 1
    ),
    'total_unsettled', COUNT(*) FILTER (WHERE was_correct IS NULL)
  ) INTO overall
  FROM fanduel_prediction_alerts
  WHERE prop_type = 'batter_rbis';

  SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb) INTO by_signal
  FROM (
    SELECT 
      signal_type,
      COUNT(*) FILTER (WHERE was_correct IS NOT NULL) as settled,
      COUNT(*) FILTER (WHERE was_correct = true) as wins,
      COUNT(*) FILTER (WHERE was_correct = false) as losses,
      ROUND(
        COUNT(*) FILTER (WHERE was_correct = true)::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE was_correct IS NOT NULL), 0) * 100, 1
      ) as win_rate
    FROM fanduel_prediction_alerts
    WHERE prop_type = 'batter_rbis'
    GROUP BY signal_type
    ORDER BY COUNT(*) FILTER (WHERE was_correct IS NOT NULL) DESC
  ) s;

  SELECT COALESCE(jsonb_agg(row_to_json(sd)::jsonb), '[]'::jsonb) INTO by_side
  FROM (
    SELECT 
      prediction as side,
      COUNT(*) FILTER (WHERE was_correct IS NOT NULL) as settled,
      COUNT(*) FILTER (WHERE was_correct = true) as wins,
      ROUND(
        COUNT(*) FILTER (WHERE was_correct = true)::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE was_correct IS NOT NULL), 0) * 100, 1
      ) as win_rate
    FROM fanduel_prediction_alerts
    WHERE prop_type = 'batter_rbis'
    GROUP BY prediction
    ORDER BY COUNT(*) FILTER (WHERE was_correct IS NOT NULL) DESC
  ) sd;

  SELECT COALESCE(jsonb_agg(row_to_json(c)::jsonb), '[]'::jsonb) INTO by_confidence
  FROM (
    SELECT 
      confidence,
      COUNT(*) FILTER (WHERE was_correct IS NOT NULL) as settled,
      COUNT(*) FILTER (WHERE was_correct = true) as wins,
      ROUND(
        COUNT(*) FILTER (WHERE was_correct = true)::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE was_correct IS NOT NULL), 0) * 100, 1
      ) as win_rate
    FROM fanduel_prediction_alerts
    WHERE prop_type = 'batter_rbis'
    GROUP BY confidence
    ORDER BY COUNT(*) FILTER (WHERE was_correct IS NOT NULL) DESC
  ) c;

  result := jsonb_build_object(
    'overall', overall,
    'by_signal_type', by_signal,
    'by_side', by_side,
    'by_confidence', by_confidence
  );

  RETURN result;
END;
$$;
