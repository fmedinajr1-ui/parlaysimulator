CREATE TABLE IF NOT EXISTS public.sweet_spot_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  funnel_mode TEXT NOT NULL DEFAULT 'core',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sweet_spot_preferences_funnel_mode_check CHECK (funnel_mode IN ('core', 'aggressive'))
);

ALTER TABLE public.sweet_spot_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sweet spot preferences" ON public.sweet_spot_preferences;
DROP POLICY IF EXISTS "Users can create own sweet spot preferences" ON public.sweet_spot_preferences;
DROP POLICY IF EXISTS "Users can update own sweet spot preferences" ON public.sweet_spot_preferences;
DROP POLICY IF EXISTS "Users can delete own sweet spot preferences" ON public.sweet_spot_preferences;

CREATE POLICY "Users can view own sweet spot preferences"
ON public.sweet_spot_preferences
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sweet spot preferences"
ON public.sweet_spot_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sweet spot preferences"
ON public.sweet_spot_preferences
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sweet spot preferences"
ON public.sweet_spot_preferences
FOR DELETE
USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sweet_spot_preferences_user_id
ON public.sweet_spot_preferences(user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
      AND pg_function_is_visible(oid)
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_sweet_spot_preferences_updated_at'
  ) THEN
    CREATE TRIGGER update_sweet_spot_preferences_updated_at
    BEFORE UPDATE ON public.sweet_spot_preferences
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;