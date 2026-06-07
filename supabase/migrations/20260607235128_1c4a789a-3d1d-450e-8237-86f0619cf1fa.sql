ALTER TABLE public.mlb_fair_price_events
  ADD COLUMN IF NOT EXISTS side text,
  ADD COLUMN IF NOT EXISTS book_price integer,
  ADD COLUMN IF NOT EXISTS opposite_book_price integer,
  ADD COLUMN IF NOT EXISTS closing_resolution_status text;

CREATE INDEX IF NOT EXISTS idx_mlb_fp_pending_closing
  ON public.mlb_fair_price_events (outcome_attached_at DESC)
  WHERE outcome_attached_at IS NOT NULL AND closing_attached_at IS NULL;

CREATE OR REPLACE VIEW public.mlb_fair_price_event_completeness AS
SELECT
  date_trunc('day', created_at AT TIME ZONE 'America/New_York')::date AS day_et,
  count(*) FILTER (WHERE gate_decision = 'fire')                               AS fires,
  count(*) FILTER (WHERE gate_decision = 'fire' AND outcome_attached_at IS NOT NULL) AS fires_with_outcome,
  count(*) FILTER (WHERE gate_decision = 'fire' AND closing_attached_at IS NOT NULL) AS fires_with_closing,
  count(*) FILTER (WHERE gate_decision = 'fire' AND outcome_attached_at IS NOT NULL
                                                AND closing_attached_at IS NOT NULL) AS fires_complete,
  avg(EXTRACT(EPOCH FROM (outcome_attached_at - created_at)))
     FILTER (WHERE outcome_attached_at IS NOT NULL)                            AS avg_outcome_latency_sec,
  avg(EXTRACT(EPOCH FROM (closing_attached_at - created_at)))
     FILTER (WHERE closing_attached_at IS NOT NULL)                            AS avg_closing_latency_sec
FROM public.mlb_fair_price_events
GROUP BY 1
ORDER BY 1 DESC;

GRANT SELECT ON public.mlb_fair_price_event_completeness TO authenticated;
GRANT ALL    ON public.mlb_fair_price_event_completeness TO service_role;