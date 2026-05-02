-- Add redemption tracking to bot_access_passwords
ALTER TABLE public.bot_access_passwords
  ADD COLUMN IF NOT EXISTS redeemed_chat_id text,
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_bot_access_passwords_password
  ON public.bot_access_passwords (password);

-- Make sure bot_authorized_users has the columns we rely on
ALTER TABLE public.bot_authorized_users
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS email text;