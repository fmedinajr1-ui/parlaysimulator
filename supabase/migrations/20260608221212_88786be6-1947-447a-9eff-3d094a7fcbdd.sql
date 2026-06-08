CREATE TABLE public.admin_alert_state (
  alert_key text PRIMARY KEY,
  status text NOT NULL,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_alert_state TO service_role;

ALTER TABLE public.admin_alert_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.admin_alert_state
  FOR ALL USING (false) WITH CHECK (false);