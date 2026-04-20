-- Phase 4: Learning Loop — metrics tracking + hook intelligence

-- Add hook tracking + viral score columns to tiktok_posts
ALTER TABLE public.tiktok_posts
  ADD COLUMN IF NOT EXISTS hook_id uuid REFERENCES public.tiktok_hook_performance(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS viral_score numeric(8,2) NOT NULL DEFAULT 0;

-- Add winning-hook flag + sample tracking
ALTER TABLE public.tiktok_hook_performance
  ADD COLUMN IF NOT EXISTS is_winning_hook boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uses_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_demoted_at timestamptz;

-- Time-series metric snapshots (one row per manual paste / cron poll)
CREATE TABLE IF NOT EXISTS public.tiktok_post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.tiktok_posts(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  avg_watch_time_sec numeric(6,2),
  completion_rate numeric(5,4),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','cron','api')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tt_metrics_post ON public.tiktok_post_metrics(post_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_tt_metrics_recorded ON public.tiktok_post_metrics(recorded_at DESC);

ALTER TABLE public.tiktok_post_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok metrics"
  ON public.tiktok_post_metrics
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));