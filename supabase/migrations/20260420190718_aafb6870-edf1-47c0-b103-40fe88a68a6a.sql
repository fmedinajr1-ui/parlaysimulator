ALTER TABLE public.tiktok_video_scripts
  ADD COLUMN IF NOT EXISTS render_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz;

ALTER TABLE public.tiktok_video_renders
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;