-- Snapshot of unified_props for change detection (cascades, flips, velocity spikes)
CREATE TABLE IF NOT EXISTS public.unified_props_snapshot (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unified_prop_id UUID NOT NULL,
  event_id TEXT NOT NULL,
  sport TEXT,
  player_name TEXT,
  prop_type TEXT,
  current_line NUMERIC,
  over_price NUMERIC,
  under_price NUMERIC,
  composite_score NUMERIC,
  confidence NUMERIC,
  recommendation TEXT,
  recommended_side TEXT,
  pvs_tier TEXT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ups_event_time ON public.unified_props_snapshot (event_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_player_time ON public.unified_props_snapshot (player_name, prop_type, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_ups_unified_prop_time ON public.unified_props_snapshot (unified_prop_id, snapshot_at DESC);

ALTER TABLE public.unified_props_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access ups" ON public.unified_props_snapshot
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Broadcast log so we don't resend the same alert
CREATE TABLE IF NOT EXISTS public.bot_signal_broadcasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES public.fanduel_prediction_alerts(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  alert_date DATE NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_id BIGINT,
  UNIQUE (alert_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_bsb_chat_alert ON public.bot_signal_broadcasts (chat_id, alert_id);
CREATE INDEX IF NOT EXISTS idx_bsb_date ON public.bot_signal_broadcasts (alert_date DESC);

ALTER TABLE public.bot_signal_broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access bsb" ON public.bot_signal_broadcasts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Engine-side dedupe (2-hour window per signal)
CREATE TABLE IF NOT EXISTS public.signal_alert_dedupe (
  dedupe_key TEXT PRIMARY KEY,
  signal_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sad_expires ON public.signal_alert_dedupe (expires_at);

ALTER TABLE public.signal_alert_dedupe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access sad" ON public.signal_alert_dedupe
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Audit view for the Telegram <-> alert mapping
CREATE OR REPLACE VIEW public.v_signal_broadcast_audit
WITH (security_invoker = true) AS
SELECT
  b.id AS broadcast_id,
  b.alert_id,
  b.chat_id,
  b.signal_type,
  b.alert_date,
  b.sent_at,
  a.signal_type AS actual_signal_type,
  a.created_at  AS alert_created_at,
  CASE
    WHEN a.id IS NULL THEN 'MISSING_ALERT'
    WHEN b.signal_type IS DISTINCT FROM a.signal_type THEN 'SIGNAL_TYPE_MISMATCH'
    WHEN b.alert_date IS DISTINCT FROM (a.created_at AT TIME ZONE 'America/New_York')::date THEN 'STORED_DATE_MISMATCH'
    WHEN abs(extract(epoch FROM (b.sent_at - a.created_at))) > 86400 THEN 'SEND_DATE_DRIFT'
    ELSE 'OK'
  END AS audit_status
FROM public.bot_signal_broadcasts b
LEFT JOIN public.fanduel_prediction_alerts a ON a.id = b.alert_id;