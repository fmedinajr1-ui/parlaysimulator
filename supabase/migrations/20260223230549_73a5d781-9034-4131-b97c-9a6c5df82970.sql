ALTER TABLE public.email_subscribers ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE public.email_subscribers ADD COLUMN IF NOT EXISTS telegram_username TEXT;