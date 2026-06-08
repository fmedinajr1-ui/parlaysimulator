CREATE TABLE public.mlb_pregame_alert_log (
  game_pk bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('30m','5m')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb,
  PRIMARY KEY (game_pk, kind)
);
GRANT SELECT ON public.mlb_pregame_alert_log TO authenticated;
GRANT ALL ON public.mlb_pregame_alert_log TO service_role;
ALTER TABLE public.mlb_pregame_alert_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read pregame alert log" ON public.mlb_pregame_alert_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));