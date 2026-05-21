UPDATE bot_daily_parlays
SET outcome = 'void',
    selection_rationale = COALESCE(selection_rationale, '') || ' | voided:team_leg_starvation'
WHERE parlay_date = (now() AT TIME ZONE 'America/New_York')::date
  AND strategy_name LIKE 'cross_sport_%'
  AND (outcome IS NULL OR outcome = 'pending');