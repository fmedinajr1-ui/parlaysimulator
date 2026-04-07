CREATE TABLE public.tracked_parlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  leg_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  final_verdict_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tracked_parlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on tracked_parlays"
  ON public.tracked_parlays
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);