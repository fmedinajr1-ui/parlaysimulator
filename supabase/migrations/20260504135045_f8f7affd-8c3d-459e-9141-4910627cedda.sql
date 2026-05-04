
-- Pup combined-action daily quota (1 parlay OR 1 scan per ET day)
CREATE TABLE IF NOT EXISTS public.pup_daily_quota (
  email TEXT NOT NULL,
  ymd_et DATE NOT NULL,
  actions_used INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email, ymd_et)
);

ALTER TABLE public.pup_daily_quota ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions). No client access.
CREATE POLICY "service_role_manages_pup_quota"
ON public.pup_daily_quota
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pup_quota_email ON public.pup_daily_quota(email);

-- Backfill: any active bot_authorized_users with NULL tier whose access code came
-- from a paid checkout (legacy Top Dog / Kennel Club) becomes all_access.
UPDATE public.bot_authorized_users bau
SET tier = 'all_access'
FROM public.bot_access_passwords bap
WHERE bau.tier IS NULL
  AND bau.is_active = true
  AND bap.redeemed_chat_id = bau.chat_id
  AND bap.created_by = 'stripe_checkout';

-- Any explicitly admin-authorized rows also get full access.
UPDATE public.bot_authorized_users
SET tier = 'all_access'
WHERE tier IS NULL
  AND is_active = true
  AND authorized_by IN ('admin', 'manual', 'grandfathered');
