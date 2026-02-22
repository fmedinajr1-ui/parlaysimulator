
-- Create bot_authorized_users table
CREATE TABLE public.bot_authorized_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id TEXT NOT NULL UNIQUE,
  username TEXT,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_by TEXT NOT NULL DEFAULT 'password',
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.bot_authorized_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on bot_authorized_users"
  ON public.bot_authorized_users FOR ALL
  USING (true) WITH CHECK (true);

-- Create bot_access_passwords table
CREATE TABLE public.bot_access_passwords (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  password TEXT NOT NULL,
  created_by TEXT NOT NULL,
  max_uses INTEGER,
  times_used INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_access_passwords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on bot_access_passwords"
  ON public.bot_access_passwords FOR ALL
  USING (true) WITH CHECK (true);

-- Create customer_daily_pnl table
CREATE TABLE public.customer_daily_pnl (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id TEXT NOT NULL,
  pnl_date DATE NOT NULL,
  daily_profit_loss NUMERIC NOT NULL DEFAULT 0,
  parlays_won INTEGER NOT NULL DEFAULT 0,
  parlays_lost INTEGER NOT NULL DEFAULT 0,
  parlays_total INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chat_id, pnl_date)
);

ALTER TABLE public.customer_daily_pnl ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on customer_daily_pnl"
  ON public.customer_daily_pnl FOR ALL
  USING (true) WITH CHECK (true);

-- Grandfather existing users from bot_activity_log
INSERT INTO public.bot_authorized_users (chat_id, authorized_by, authorized_at)
SELECT DISTINCT (metadata->>'chat_id')::text, 'grandfathered', MIN(created_at)
FROM public.bot_activity_log
WHERE metadata->>'chat_id' IS NOT NULL
  AND (metadata->>'chat_id')::text != ''
GROUP BY (metadata->>'chat_id')::text
ON CONFLICT (chat_id) DO NOTHING;
