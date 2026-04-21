ALTER TABLE public.tiktok_accounts
  ADD COLUMN IF NOT EXISTS blotato_account_id text,
  ADD COLUMN IF NOT EXISTS auto_post_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tiktok_post_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL,
  render_id uuid,
  account_id uuid NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  blotato_post_id text,
  blotato_response jsonb,
  caption text,
  hashtags text[],
  video_url text,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  posted_at timestamptz,
  tiktok_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_post_queue_status_time
  ON public.tiktok_post_queue (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_tiktok_post_queue_account
  ON public.tiktok_post_queue (account_id);

ALTER TABLE public.tiktok_post_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tiktok_post_queue"
  ON public.tiktok_post_queue
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tiktok_post_queue_updated_at
  BEFORE UPDATE ON public.tiktok_post_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();