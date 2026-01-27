-- Add unique constraint on market_key for whale_picks upserts
ALTER TABLE public.whale_picks 
ADD CONSTRAINT whale_picks_market_key_key UNIQUE (market_key);