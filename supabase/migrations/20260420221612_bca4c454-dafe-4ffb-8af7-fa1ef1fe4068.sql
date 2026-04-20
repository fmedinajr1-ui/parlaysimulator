-- Phase 3: Manual posting workflow
-- ============================================================

-- 1. Add caption + hashtag finalization fields to scripts
ALTER TABLE public.tiktok_video_scripts
  ADD COLUMN IF NOT EXISTS final_caption text,
  ADD COLUMN IF NOT EXISTS final_hashtags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS caption_generated_at timestamptz;

-- 2. Add manual posting fields to posts
ALTER TABLE public.tiktok_posts
  ADD COLUMN IF NOT EXISTS posted_manually_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_post_url text,
  ADD COLUMN IF NOT EXISTS view_count_snapshot integer,
  ADD COLUMN IF NOT EXISTS last_metrics_check_at timestamptz;

-- Allow new "ready_to_post" status for posts in publish queue
ALTER TABLE public.tiktok_posts DROP CONSTRAINT IF EXISTS tiktok_posts_status_check;
ALTER TABLE public.tiktok_posts ADD CONSTRAINT tiktok_posts_status_check
  CHECK (status = ANY (ARRAY[
    'scheduled'::text,'uploading'::text,'posted'::text,'failed'::text,
    'cancelled'::text,'ready_to_post'::text,'posted_manually'::text
  ]));

-- 3. Schedule slots per account
CREATE TABLE IF NOT EXISTS public.tiktok_post_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.tiktok_accounts(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour_et smallint NOT NULL CHECK (hour_et BETWEEN 0 AND 23),
  minute_et smallint NOT NULL DEFAULT 0 CHECK (minute_et BETWEEN 0 AND 59),
  slot_label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, day_of_week, hour_et, minute_et)
);

CREATE INDEX IF NOT EXISTS idx_tt_schedule_account ON public.tiktok_post_schedule(account_id, day_of_week, hour_et);

ALTER TABLE public.tiktok_post_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage tiktok schedule" ON public.tiktok_post_schedule;
CREATE POLICY "Admins manage tiktok schedule"
  ON public.tiktok_post_schedule
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_tt_schedule_updated ON public.tiktok_post_schedule;
CREATE TRIGGER trg_tt_schedule_updated
  BEFORE UPDATE ON public.tiktok_post_schedule
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Seed default slots for any existing active/warming accounts
-- 4 high-engagement TikTok windows per week (Mon 7pm, Wed 7pm, Fri 8pm, Sun 7pm ET)
INSERT INTO public.tiktok_post_schedule (account_id, day_of_week, hour_et, minute_et, slot_label)
SELECT a.id, d.dow, d.hr, 0, d.lbl
FROM public.tiktok_accounts a
CROSS JOIN (VALUES
  (1, 19, 'Mon prime'),
  (3, 19, 'Wed prime'),
  (5, 20, 'Fri prime'),
  (0, 19, 'Sun prime')
) AS d(dow, hr, lbl)
WHERE a.status IN ('active','warming')
ON CONFLICT (account_id, day_of_week, hour_et, minute_et) DO NOTHING;