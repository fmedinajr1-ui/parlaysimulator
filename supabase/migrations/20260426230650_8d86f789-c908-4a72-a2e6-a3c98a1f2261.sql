DROP VIEW IF EXISTS public.v_parlay_broadcast_audit;

CREATE VIEW public.v_parlay_broadcast_audit
WITH (security_invoker = true) AS
SELECT
  b.id                                                                        AS broadcast_id,
  b.parlay_id,
  b.chat_id,
  b.telegram_message_id,
  b.sent_at,
  (b.sent_at AT TIME ZONE 'America/New_York')::date                           AS sent_et_date,
  b.parlay_date                                                               AS broadcast_parlay_date,
  p.parlay_date                                                               AS parlay_table_date,
  p.strategy_name,
  p.tier,
  p.leg_count,
  CASE
    WHEN p.id IS NULL THEN 'MISSING_PARLAY'
    WHEN b.parlay_date IS NOT NULL AND b.parlay_date <> p.parlay_date THEN 'STORED_DATE_MISMATCH'
    WHEN p.parlay_date <> ((b.sent_at AT TIME ZONE 'America/New_York')::date) THEN 'SEND_DATE_DRIFT'
    ELSE 'OK'
  END                                                                         AS status
FROM public.bot_parlay_broadcasts b
LEFT JOIN public.bot_daily_parlays p ON p.id = b.parlay_id;