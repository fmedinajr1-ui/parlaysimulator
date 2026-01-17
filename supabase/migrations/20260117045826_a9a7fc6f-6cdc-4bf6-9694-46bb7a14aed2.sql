-- Add line calibration tracking columns to nba_risk_engine_picks
ALTER TABLE public.nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS line_deviation_pct numeric,
ADD COLUMN IF NOT EXISTS is_trap_line boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS trap_type text,
ADD COLUMN IF NOT EXISTS calibrated_edge numeric;