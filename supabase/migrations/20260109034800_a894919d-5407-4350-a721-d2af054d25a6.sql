-- Add missing is_star column to nba_risk_engine_picks
ALTER TABLE public.nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS is_star BOOLEAN DEFAULT false;