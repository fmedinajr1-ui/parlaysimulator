
-- Add bankroll column to bot_authorized_users for per-customer bankroll tracking
ALTER TABLE public.bot_authorized_users 
ADD COLUMN IF NOT EXISTS bankroll NUMERIC DEFAULT 500;

-- Add bankroll column to customer_daily_pnl for daily snapshots
ALTER TABLE public.customer_daily_pnl 
ADD COLUMN IF NOT EXISTS bankroll NUMERIC DEFAULT 0;

-- Add unique constraint for upsert support on customer_daily_pnl
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_daily_pnl_chat_id_pnl_date_key'
  ) THEN
    ALTER TABLE public.customer_daily_pnl ADD CONSTRAINT customer_daily_pnl_chat_id_pnl_date_key UNIQUE (chat_id, pnl_date);
  END IF;
END $$;
