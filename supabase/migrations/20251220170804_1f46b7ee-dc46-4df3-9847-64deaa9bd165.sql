-- Add prop_targets JSONB column to store player-specific betting recommendations
ALTER TABLE public.sports_fatigue_scores 
ADD COLUMN IF NOT EXISTS prop_targets JSONB DEFAULT NULL;

-- Add an index for efficient querying of prop targets
CREATE INDEX IF NOT EXISTS idx_sports_fatigue_scores_prop_targets 
ON public.sports_fatigue_scores USING GIN (prop_targets);

-- Add comment for documentation
COMMENT ON COLUMN public.sports_fatigue_scores.prop_targets IS 'Player-specific prop betting targets based on fatigue analysis: {fade_team, lean_team, player_props: [{player, prop, direction, reason}], confidence, edge_factors}';