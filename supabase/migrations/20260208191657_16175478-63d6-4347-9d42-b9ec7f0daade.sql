-- Create conversation history table for two-way Telegram bot communication
CREATE TABLE public.bot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast retrieval of recent conversation history
CREATE INDEX idx_bot_conversations_chat ON public.bot_conversations(telegram_chat_id, created_at DESC);

-- Enable RLS (optional - bot operates without user auth)
ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now (bot uses service role key)
CREATE POLICY "Bot conversations are accessible" ON public.bot_conversations FOR ALL USING (true);