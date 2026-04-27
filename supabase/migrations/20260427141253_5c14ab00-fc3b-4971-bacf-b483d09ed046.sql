-- Public bucket for marketing/explainer videos
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-videos', 'marketing-videos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy for marketing videos (anyone with the URL can play)
DROP POLICY IF EXISTS "marketing videos public read" ON storage.objects;
CREATE POLICY "marketing videos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'marketing-videos');

-- Broadcast tracking
CREATE TABLE IF NOT EXISTS public.bot_video_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url text NOT NULL,
  caption text,
  created_by text DEFAULT 'admin',
  status text NOT NULL DEFAULT 'pending', -- pending | admin_sent | broadcast_sent
  admin_message_id bigint,
  recipients_total int DEFAULT 0,
  recipients_succeeded int DEFAULT 0,
  recipients_failed int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  broadcast_at timestamptz
);
ALTER TABLE public.bot_video_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access bot_video_broadcasts" ON public.bot_video_broadcasts;
CREATE POLICY "service role full access bot_video_broadcasts"
ON public.bot_video_broadcasts FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Per-chat delivery log
CREATE TABLE IF NOT EXISTS public.bot_video_broadcast_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.bot_video_broadcasts(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  message_id bigint,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (broadcast_id, chat_id)
);
ALTER TABLE public.bot_video_broadcast_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role full access bot_video_broadcast_recipients" ON public.bot_video_broadcast_recipients;
CREATE POLICY "service role full access bot_video_broadcast_recipients"
ON public.bot_video_broadcast_recipients FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_video_broadcast_recipients_broadcast ON public.bot_video_broadcast_recipients(broadcast_id);