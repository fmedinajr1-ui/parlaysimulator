ALTER TABLE public.bot_authorized_users 
ADD COLUMN IF NOT EXISTS bankroll_confirmed_date DATE;