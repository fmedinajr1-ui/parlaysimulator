-- Add missing stat_priority column to nba_risk_engine_picks
ALTER TABLE public.nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS stat_priority INTEGER DEFAULT 0;