INSERT INTO bot_owner_rules (rule_key, rule_description, rule_logic, applies_to)
VALUES ('mlb_moneyline_context', 
  'MLB moneyline uses TAKE/FADE labels. Pitcher quality (ERA, K/9) and team strength factor into direction. Never blindly follow line movement without pitcher context.',
  '{"labels":"TAKE_FADE_not_OVER_UNDER","pitcher_gate":"ace_boost_10_struggling_penalty_10","direction":"shortening_equals_TAKE_lengthening_equals_FADE"}'::jsonb,
  ARRAY['fanduel-prediction-alerts'])
ON CONFLICT (rule_key) DO UPDATE SET rule_description = EXCLUDED.rule_description, rule_logic = EXCLUDED.rule_logic;