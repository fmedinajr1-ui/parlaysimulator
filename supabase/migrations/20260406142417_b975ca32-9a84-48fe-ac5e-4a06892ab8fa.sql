INSERT INTO bot_owner_rules (rule_key, rule_description, rule_logic, applies_to, enforcement, is_active)
VALUES (
  'nba_data_driven_direction',
  'NBA player props use L10/L3 data + minutes to determine direction, not blind snapback. Hard blocks players with <15 avg minutes. Warns <20 min. Volatile L3 divergence follows recent trend.',
  '{"logic":"l10_avg_vs_line_determines_direction","minutes_hard_block_under":15,"minutes_soft_warn_under":20,"minutes_cv_penalty_above":0.30,"volatile_l3_divergence_threshold":0.15,"fallback":"market_follow"}'::jsonb,
  ARRAY['fanduel-prediction-alerts'],
  'hard_block',
  true
)
ON CONFLICT (rule_key) DO UPDATE SET 
  rule_description = EXCLUDED.rule_description, 
  rule_logic = EXCLUDED.rule_logic,
  updated_at = now();