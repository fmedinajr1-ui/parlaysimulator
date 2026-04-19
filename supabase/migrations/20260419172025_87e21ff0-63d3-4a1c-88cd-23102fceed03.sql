-- Add drip funnel columns to existing email_subscribers
ALTER TABLE public.email_subscribers
  ADD COLUMN IF NOT EXISTS drip_day INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drip_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_drip_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_to_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_email_subscribers_drip
  ON public.email_subscribers (drip_day, drip_paused, unsubscribed_at)
  WHERE unsubscribed_at IS NULL AND drip_paused = false;

-- Grade events log (anonymous)
CREATE TABLE IF NOT EXISTS public.grade_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  letter_grade TEXT NOT NULL,
  leg_count INTEGER NOT NULL DEFAULT 0,
  composite_score NUMERIC,
  share_card_id UUID,
  share_card_opens INTEGER NOT NULL DEFAULT 0,
  email_captured BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grade_events_created ON public.grade_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grade_events_share ON public.grade_events (share_card_id) WHERE share_card_id IS NOT NULL;

ALTER TABLE public.grade_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can log grade events" ON public.grade_events;
CREATE POLICY "Anyone can log grade events"
ON public.grade_events FOR INSERT
TO anon, authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view grade events" ON public.grade_events;
CREATE POLICY "Admins can view grade events"
ON public.grade_events FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));