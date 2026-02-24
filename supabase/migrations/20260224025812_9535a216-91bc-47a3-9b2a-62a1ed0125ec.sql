UPDATE bot_daily_parlays 
SET outcome = 'void', lesson_learned = 'Voided: generated with stale logic missing performance-aware scoring'
WHERE parlay_date = '2026-02-23' 
AND strategy_name = 'force_mispriced_conviction' 
AND outcome = 'pending'