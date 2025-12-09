-- Add season standings columns to unified_props table
ALTER TABLE public.unified_props 
ADD COLUMN IF NOT EXISTS home_team_win_pct NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS away_team_win_pct NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS record_differential NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_trap_favorite BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS home_team_record TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS away_team_record TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS record_score NUMERIC DEFAULT 0;

-- Add index for trap favorite queries
CREATE INDEX IF NOT EXISTS idx_unified_props_trap_favorite ON public.unified_props(is_trap_favorite) WHERE is_trap_favorite = true;

-- Add index for record differential queries
CREATE INDEX IF NOT EXISTS idx_unified_props_record_diff ON public.unified_props(record_differential) WHERE record_differential > 0.1;