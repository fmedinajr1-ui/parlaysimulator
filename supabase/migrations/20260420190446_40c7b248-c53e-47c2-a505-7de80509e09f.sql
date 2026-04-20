-- TikTok render pipeline: storage bucket + status enum extensions

-- Storage bucket for renders (audio, b-roll, final MP4s)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tiktok-renders',
  'tiktok-renders',
  false,
  524288000, -- 500MB
  ARRAY['audio/mpeg', 'audio/mp3', 'audio/wav', 'video/mp4', 'video/quicktime', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Admin-only read/write on tiktok-renders bucket
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tiktok_renders_admin_select') THEN
    CREATE POLICY "tiktok_renders_admin_select" ON storage.objects FOR SELECT
      USING (bucket_id = 'tiktok-renders' AND public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tiktok_renders_admin_insert') THEN
    CREATE POLICY "tiktok_renders_admin_insert" ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'tiktok-renders' AND public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tiktok_renders_admin_update') THEN
    CREATE POLICY "tiktok_renders_admin_update" ON storage.objects FOR UPDATE
      USING (bucket_id = 'tiktok-renders' AND public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tiktok_renders_admin_delete') THEN
    CREATE POLICY "tiktok_renders_admin_delete" ON storage.objects FOR DELETE
      USING (bucket_id = 'tiktok-renders' AND public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- Add columns to tiktok_video_renders that the orchestrator needs
ALTER TABLE public.tiktok_video_renders
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS audio_duration_sec numeric,
  ADD COLUMN IF NOT EXISTS audio_timings jsonb,
  ADD COLUMN IF NOT EXISTS avatar_video_url text,
  ADD COLUMN IF NOT EXISTS avatar_provider_job_id text,
  ADD COLUMN IF NOT EXISTS broll_urls jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_video_url text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS render_provider text DEFAULT 'remotion_worker',
  ADD COLUMN IF NOT EXISTS worker_job_id text,
  ADD COLUMN IF NOT EXISTS step text DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS step_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS cost_breakdown jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_tiktok_renders_status ON public.tiktok_video_renders(status);
CREATE INDEX IF NOT EXISTS idx_tiktok_renders_step ON public.tiktok_video_renders(step);