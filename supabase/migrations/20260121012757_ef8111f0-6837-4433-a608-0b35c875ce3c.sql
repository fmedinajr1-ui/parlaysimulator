-- Add source tracking to lineup_alerts
ALTER TABLE public.lineup_alerts 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'unknown';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_lineup_alerts_source 
ON public.lineup_alerts(source);