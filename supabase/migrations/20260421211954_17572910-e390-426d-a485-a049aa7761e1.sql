CREATE TABLE public.bot_parlay_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_id uuid NOT NULL REFERENCES public.bot_daily_parlays(id) ON DELETE CASCADE,
  chat_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  telegram_message_id bigint,
  UNIQUE (parlay_id, chat_id)
);

ALTER TABLE public.bot_parlay_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role manages broadcasts"
  ON public.bot_parlay_broadcasts
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_bot_parlay_broadcasts_parlay_id ON public.bot_parlay_broadcasts(parlay_id);
CREATE INDEX idx_bot_parlay_broadcasts_chat_id ON public.bot_parlay_broadcasts(chat_id);