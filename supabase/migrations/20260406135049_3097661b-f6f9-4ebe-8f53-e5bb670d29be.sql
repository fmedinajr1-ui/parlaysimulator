INSERT INTO public.bot_owner_rules (rule_key, rule_description, applies_to, enforcement, is_active, rule_logic)
VALUES (
  'non_nba_follow_market',
  'Non-NBA props (NHL, MLB, NCAAB, etc.) must follow market direction on Take It Now signals. Line rising = OVER, line dropping = UNDER. Regression/snapback logic is only valid for NBA player props.',
  ARRAY['fanduel-prediction-alerts', 'bot-self-audit'],
  'hard_block',
  true,
  '{"sports_excluded_from_regression": ["NHL", "MLB", "NCAAB", "NCAAF", "NFL", "WNBA", "MLS"], "logic": "non-NBA props follow market direction, not regression", "signal_types": ["take_it_now", "live_drift"]}'::jsonb
)
ON CONFLICT DO NOTHING;