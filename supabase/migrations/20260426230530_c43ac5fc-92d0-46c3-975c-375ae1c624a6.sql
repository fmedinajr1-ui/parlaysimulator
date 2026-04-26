-- 1. Add parlay_date column to broadcast log
ALTER TABLE public.bot_parlay_broadcasts
  ADD COLUMN IF NOT EXISTS parlay_date date;

-- 2. Backfill parlay_date from linked parlay rows
UPDATE public.bot_parlay_broadcasts b
SET parlay_date = p.parlay_date
FROM public.bot_daily_parlays p
WHERE b.parlay_id = p.id
  AND b.parlay_date IS NULL;

-- 3. Add FK (drop first if it somehow exists, then create)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bot_parlay_broadcasts_parlay_id_fkey'
  ) THEN
    ALTER TABLE public.bot_parlay_broadcasts
      ADD CONSTRAINT bot_parlay_broadcasts_parlay_id_fkey
      FOREIGN KEY (parlay_id)
      REFERENCES public.bot_daily_parlays(id)
      ON DELETE CASCADE;
  END IF;
END$$;

-- 4. Index for the dedup lookup (chat_id + parlay_id)
CREATE INDEX IF NOT EXISTS idx_bot_parlay_broadcasts_chat_parlay
  ON public.bot_parlay_broadcasts (chat_id, parlay_id);

-- 5. Audit view
CREATE OR REPLACE VIEW public.v_parlay_broadcast_audit AS
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