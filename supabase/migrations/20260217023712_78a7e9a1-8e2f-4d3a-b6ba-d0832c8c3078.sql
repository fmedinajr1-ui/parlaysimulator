-- Add last-5-game trend columns to ncaab_team_stats
ALTER TABLE public.ncaab_team_stats 
ADD COLUMN IF NOT EXISTS last_5_ppg numeric,
ADD COLUMN IF NOT EXISTS last_5_oppg numeric,
ADD COLUMN IF NOT EXISTS streak text,
ADD COLUMN IF NOT EXISTS last_5_ats text;