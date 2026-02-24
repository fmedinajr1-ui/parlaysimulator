
-- Backfill bot_player_performance from existing settled parlay legs
-- Extract individual leg outcomes from settled parlays (won/lost)
WITH settled_legs AS (
  SELECT
    leg->>'player_name' AS player_name,
    LOWER(leg->>'prop_type') AS prop_type,
    LOWER(COALESCE(leg->>'side', 'over')) AS side,
    leg->>'outcome' AS outcome
  FROM bot_daily_parlays,
       jsonb_array_elements(legs::jsonb) AS leg
  WHERE outcome IN ('won', 'lost')
    AND leg->>'player_name' IS NOT NULL
    AND leg->>'prop_type' IS NOT NULL
    AND leg->>'outcome' IN ('hit', 'miss')
    AND leg->>'type' IS DISTINCT FROM 'team'
),
player_stats AS (
  SELECT
    player_name,
    prop_type,
    side,
    COUNT(*) AS legs_played,
    COUNT(*) FILTER (WHERE outcome = 'hit') AS legs_won,
    CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE outcome = 'hit')::numeric / COUNT(*) ELSE 0 END AS hit_rate
  FROM settled_legs
  GROUP BY player_name, prop_type, side
)
INSERT INTO bot_player_performance (player_name, prop_type, side, legs_played, legs_won, hit_rate, last_updated)
SELECT player_name, prop_type, side, legs_played, legs_won, hit_rate, CURRENT_DATE
FROM player_stats
ON CONFLICT (player_name, prop_type, side) DO UPDATE SET
  legs_played = EXCLUDED.legs_played,
  legs_won = EXCLUDED.legs_won,
  hit_rate = EXCLUDED.hit_rate,
  last_updated = CURRENT_DATE;

-- Backfill bot_prop_type_performance from existing settled parlay legs
WITH settled_legs AS (
  SELECT
    LOWER(leg->>'prop_type') AS prop_type,
    leg->>'outcome' AS outcome
  FROM bot_daily_parlays,
       jsonb_array_elements(legs::jsonb) AS leg
  WHERE outcome IN ('won', 'lost')
    AND leg->>'prop_type' IS NOT NULL
    AND leg->>'outcome' IN ('hit', 'miss')
    AND leg->>'type' IS DISTINCT FROM 'team'
),
prop_stats AS (
  SELECT
    prop_type,
    COUNT(*) AS total_legs,
    COUNT(*) FILTER (WHERE outcome = 'hit') AS legs_won,
    CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER (WHERE outcome = 'hit')::numeric / COUNT(*) ELSE 0 END AS hit_rate
  FROM settled_legs
  GROUP BY prop_type
)
INSERT INTO bot_prop_type_performance (prop_type, total_legs, legs_won, hit_rate, is_blocked, is_boosted, boost_multiplier, last_updated)
SELECT 
  prop_type, 
  total_legs, 
  legs_won, 
  hit_rate,
  (total_legs >= 5 AND hit_rate < 0.25) AS is_blocked,
  (total_legs >= 10 AND hit_rate > 0.60) AS is_boosted,
  CASE WHEN total_legs >= 10 AND hit_rate > 0.60 THEN 1.2 ELSE 1.0 END AS boost_multiplier,
  CURRENT_DATE
FROM prop_stats
ON CONFLICT (prop_type) DO UPDATE SET
  total_legs = EXCLUDED.total_legs,
  legs_won = EXCLUDED.legs_won,
  hit_rate = EXCLUDED.hit_rate,
  is_blocked = EXCLUDED.is_blocked,
  is_boosted = EXCLUDED.is_boosted,
  boost_multiplier = EXCLUDED.boost_multiplier,
  last_updated = CURRENT_DATE;
