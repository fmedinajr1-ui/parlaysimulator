
CREATE TYPE public.prop_verifier_verdict AS ENUM ('APPROVE','CAUTION','REJECT');

CREATE TABLE public.prop_alert_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL,
  source_table text NOT NULL,
  player_name text,
  sport text,
  prop_type text,
  side text,
  line numeric,
  event_id text,
  verdict public.prop_verifier_verdict NOT NULL,
  verdict_confidence integer,
  confidence_multiplier numeric NOT NULL DEFAULT 1.0,
  reasoning text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags text[] NOT NULL DEFAULT '{}',
  research_model text,
  judge_model text,
  tokens_used integer,
  cost_usd numeric,
  research_ms integer,
  status text NOT NULL DEFAULT 'complete',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prop_alert_verdicts_alert_uniq ON public.prop_alert_verdicts(source_table, alert_id);
CREATE INDEX prop_alert_verdicts_created_idx ON public.prop_alert_verdicts(created_at DESC);
CREATE INDEX prop_alert_verdicts_sport_verdict_idx ON public.prop_alert_verdicts(sport, verdict);
CREATE INDEX prop_alert_verdicts_player_prop_idx ON public.prop_alert_verdicts(player_name, prop_type, created_at DESC);

GRANT SELECT ON public.prop_alert_verdicts TO authenticated;
GRANT ALL ON public.prop_alert_verdicts TO service_role;

ALTER TABLE public.prop_alert_verdicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Verdicts readable by authenticated"
ON public.prop_alert_verdicts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Verdicts service write"
ON public.prop_alert_verdicts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.prop_alert_verifier_daily_cost (
  cost_date date PRIMARY KEY DEFAULT (now() AT TIME ZONE 'America/New_York')::date,
  verdicts_count integer NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.prop_alert_verifier_daily_cost TO authenticated;
GRANT ALL ON public.prop_alert_verifier_daily_cost TO service_role;

ALTER TABLE public.prop_alert_verifier_daily_cost ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily cost readable by authenticated"
ON public.prop_alert_verifier_daily_cost FOR SELECT TO authenticated USING (true);

CREATE POLICY "Daily cost service write"
ON public.prop_alert_verifier_daily_cost FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_prop_alert_verdicts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER prop_alert_verdicts_touch
BEFORE UPDATE ON public.prop_alert_verdicts
FOR EACH ROW EXECUTE FUNCTION public.touch_prop_alert_verdicts();
