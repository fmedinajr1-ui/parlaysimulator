-- Settle stale RBI Unders: any past-dated PENDING row with no game log within ±1 day of analysis_date is treated as DNP → VOID.
UPDATE public.mlb_rbi_under_analysis p
SET result = 'VOID',
    settled_at = now()
WHERE result = 'PENDING'
  AND analysis_date < (CURRENT_DATE - INTERVAL '1 day')
  AND NOT EXISTS (
    SELECT 1 FROM public.mlb_player_game_logs g
    WHERE lower(g.player_name) = lower(p.player_name)
      AND g.game_date BETWEEN p.analysis_date - INTERVAL '1 day' AND p.analysis_date + INTERVAL '1 day'
  );