
-- Signal mute config
CREATE TABLE public.alert_signal_config (
  signal_type TEXT PRIMARY KEY,
  muted BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_signal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view signal config"
ON public.alert_signal_config FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can modify signal config"
ON public.alert_signal_config FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Audit log
CREATE TABLE public.alert_signal_config_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  actor TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.alert_signal_config_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view signal audit"
ON public.alert_signal_config_audit FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.log_alert_signal_config_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.alert_signal_config_audit (signal_type, source, actor, old_values, new_values)
  VALUES (
    COALESCE(NEW.signal_type, OLD.signal_type),
    COALESCE(current_setting('app.audit_source', true), 'db'),
    COALESCE(NEW.updated_by, OLD.updated_by, 'system'),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_alert_signal_config_audit
AFTER INSERT OR UPDATE OR DELETE ON public.alert_signal_config
FOR EACH ROW EXECUTE FUNCTION public.log_alert_signal_config_change();

-- Seed
INSERT INTO public.alert_signal_config (signal_type, muted, reason, updated_by) VALUES
  ('cascade', false, NULL, 'system:seed'),
  ('velocity_spike', false, NULL, 'system:seed'),
  ('take_it_now', true, '7d audit: 2/14 = 14% hit rate', 'system:seed');

-- Retune ALL/model_edge defaults to asymmetric per audit
UPDATE public.alert_thresholds
SET aligned_over = 0.3, aligned_under = 0.3,
    against_over = -1.0, against_under = -1.0,
    updated_by = 'system:audit_v2', updated_at = now()
WHERE sport = 'ALL' AND axis = 'model_edge';

-- If row didn't exist yet, insert it
INSERT INTO public.alert_thresholds (sport, axis, aligned_over, aligned_under, against_over, against_under, neutral_band, updated_by)
SELECT 'ALL', 'model_edge', 0.3, 0.3, -1.0, -1.0, NULL, 'system:audit_v2'
WHERE NOT EXISTS (SELECT 1 FROM public.alert_thresholds WHERE sport = 'ALL' AND axis = 'model_edge');
