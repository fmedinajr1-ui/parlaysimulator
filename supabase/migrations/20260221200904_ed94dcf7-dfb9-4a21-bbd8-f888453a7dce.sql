
-- Add team total cross-reference columns to mispriced_lines
ALTER TABLE public.mispriced_lines ADD COLUMN IF NOT EXISTS team_total_signal text;
ALTER TABLE public.mispriced_lines ADD COLUMN IF NOT EXISTS team_total_alignment text;

-- Add index for filtering by alignment
CREATE INDEX IF NOT EXISTS idx_mispriced_lines_team_total_alignment 
ON public.mispriced_lines (team_total_alignment) 
WHERE team_total_alignment IS NOT NULL;
