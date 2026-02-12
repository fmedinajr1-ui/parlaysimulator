
-- Create view for NCAAB team accuracy metrics
CREATE OR REPLACE VIEW public.ncaab_team_accuracy_metrics AS
SELECT 
  sport,
  bet_type,
  COUNT(*) as total_bets,
  COUNT(*) FILTER (WHERE outcome = 'hit') as wins,
  COUNT(*) FILTER (WHERE outcome = 'miss') as losses,
  COUNT(*) FILTER (WHERE outcome = 'push') as pushes,
  CASE 
    WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
    THEN ROUND(
      COUNT(*) FILTER (WHERE outcome = 'hit')::numeric / 
      COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::numeric * 100, 1
    )
    ELSE 0 
  END as win_rate,
  COUNT(*) FILTER (WHERE outcome IS NULL OR outcome = 'no_data') as unsettled
FROM public.game_bets
WHERE sport LIKE '%ncaab%' OR sport LIKE '%college%'
GROUP BY sport, bet_type
ORDER BY win_rate DESC;
