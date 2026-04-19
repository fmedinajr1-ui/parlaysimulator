-- Personalized onboarding preferences for Telegram customers
CREATE TABLE IF NOT EXISTS public.bot_user_preferences (
  chat_id text PRIMARY KEY,
  bet_type text NOT NULL DEFAULT 'both' CHECK (bet_type IN ('parlays_only','singles_only','both')),
  sports text[] NOT NULL DEFAULT ARRAY['NBA','MLB','NFL','NHL']::text[],
  bankroll_size numeric NOT NULL DEFAULT 1000,
  risk_profile text NOT NULL DEFAULT 'balanced' CHECK (risk_profile IN ('conservative','balanced','aggressive')),
  min_confidence numeric NOT NULL DEFAULT 65,
  max_legs integer NOT NULL DEFAULT 3,
  preferred_alert_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  onboarding_step text NOT NULL DEFAULT 'awaiting_bet_type'
    CHECK (onboarding_step IN ('awaiting_bet_type','awaiting_sports','awaiting_bankroll','awaiting_risk','complete','legacy_skip')),
  pending_sports text[] NOT NULL DEFAULT ARRAY[]::text[],
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_modified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_user_prefs_step ON public.bot_user_preferences(onboarding_step);
CREATE INDEX IF NOT EXISTS idx_bot_user_prefs_sports ON public.bot_user_preferences USING GIN(sports);

ALTER TABLE public.bot_user_preferences ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions use service key; no direct end-user access)
CREATE POLICY "Service role full access on bot_user_preferences"
  ON public.bot_user_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Touch trigger
CREATE OR REPLACE FUNCTION public.touch_bot_user_preferences()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.last_modified_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_bot_user_preferences ON public.bot_user_preferences;
CREATE TRIGGER trg_touch_bot_user_preferences
  BEFORE UPDATE ON public.bot_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.touch_bot_user_preferences();

-- Seed existing active users as legacy_skip so they keep getting all alerts
INSERT INTO public.bot_user_preferences (chat_id, onboarding_step, bet_type, risk_profile, min_confidence, max_legs, sports, bankroll_size)
SELECT
  chat_id,
  'legacy_skip',
  'both',
  'balanced',
  0,
  5,
  ARRAY['NBA','MLB','NFL','NHL','tennis','soccer']::text[],
  COALESCE(bankroll, 1000)
FROM public.bot_authorized_users
WHERE is_active = true
ON CONFLICT (chat_id) DO NOTHING;
