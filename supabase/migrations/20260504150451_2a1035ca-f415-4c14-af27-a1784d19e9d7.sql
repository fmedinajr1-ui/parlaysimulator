-- alert_thresholds: per-sport, per-axis cutoffs for the cascade explainer
CREATE TABLE public.alert_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  axis TEXT NOT NULL,
  aligned_over NUMERIC,
  aligned_under NUMERIC,
  against_over NUMERIC,
  against_under NUMERIC,
  neutral_band NUMERIC,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  UNIQUE (sport, axis)
);

CREATE INDEX idx_alert_thresholds_sport ON public.alert_thresholds (sport);

ALTER TABLE public.alert_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read alert_thresholds"
ON public.alert_thresholds FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Admins can insert alert_thresholds"
ON public.alert_thresholds FOR INSERT
TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update alert_thresholds"
ON public.alert_thresholds FOR UPDATE
TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete alert_thresholds"
ON public.alert_thresholds FOR DELETE
TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- alert_thresholds_audit: insert-only history
CREATE TABLE public.alert_thresholds_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  axis TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  source TEXT NOT NULL,        -- 'web' | 'telegram' | 'system'
  actor TEXT,                  -- 'web:<user_id>' | 'tg:<chat_id>' | 'system'
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_thresholds_audit_sport ON public.alert_thresholds_audit (sport, changed_at DESC);

ALTER TABLE public.alert_thresholds_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read threshold audit"
ON public.alert_thresholds_audit FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Admins can insert threshold audit"
ON public.alert_thresholds_audit FOR INSERT
TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- system_config: tiny key/value, used here for cache version bumps
CREATE TABLE IF NOT EXISTS public.system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read system_config"
ON public.system_config FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Admins can manage system_config"
ON public.system_config FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.system_config (key, value, updated_by)
VALUES ('thresholds_version', '1'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

-- Trigger: bump thresholds_version + write audit on every change
CREATE OR REPLACE FUNCTION public.alert_thresholds_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_source TEXT;
  v_actor TEXT;
BEGIN
  v_old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_actor := COALESCE(NEW.updated_by, OLD.updated_by, 'system');
  v_source := CASE
    WHEN v_actor LIKE 'tg:%' THEN 'telegram'
    WHEN v_actor LIKE 'web:%' THEN 'web'
    ELSE 'system'
  END;
  INSERT INTO public.alert_thresholds_audit (sport, axis, old_values, new_values, source, actor)
  VALUES (
    COALESCE(NEW.sport, OLD.sport),
    COALESCE(NEW.axis, OLD.axis),
    v_old, v_new, v_source, v_actor
  );
  -- Bump cache version
  UPDATE public.system_config
     SET value = to_jsonb((COALESCE(NULLIF(value::text,''),'0')::int + 1)),
         updated_at = now(),
         updated_by = v_actor
   WHERE key = 'thresholds_version';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alert_thresholds_after_change
AFTER INSERT OR UPDATE OR DELETE ON public.alert_thresholds
FOR EACH ROW EXECUTE FUNCTION public.alert_thresholds_after_change();

-- Seed defaults (v2 values)
INSERT INTO public.alert_thresholds (sport, axis, aligned_over, aligned_under, against_over, against_under, neutral_band, notes, updated_by) VALUES
('ALL', 'form',       0.55, 0.55, 0.25, 0.25, NULL, 'Hit-rate cutoffs for L10 form axis', 'system'),
('ALL', 'defense',    20,   13,   12,   20,   NULL, 'Position defense rank: aligned/against per side', 'system'),
('ALL', 'pace',       220,  213,  213,  220,  NULL, 'Vegas total cutoffs (NBA defaults; MLB overridden)', 'system'),
('MLB', 'pace',       9,    7.5,  7.5,  9,    NULL, 'MLB total cutoffs', 'system'),
('ALL', 'juice',      20,   20,   5,    5,    NULL, 'Juice gap: aligned ≥ aligned_*, neutral ≥ against_*, else against', 'system'),
('ALL', 'model_edge', 0.5,  0.5,  -0.5, -0.5, NULL, 'Signed (mean - line)/std cutoffs for the alerted side', 'system');