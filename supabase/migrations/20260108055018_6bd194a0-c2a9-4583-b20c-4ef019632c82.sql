-- Drop the existing check constraint
ALTER TABLE nba_risk_engine_picks 
DROP CONSTRAINT IF EXISTS nba_risk_engine_picks_player_role_check;

-- Add updated constraint with BALL_DOMINANT_STAR
ALTER TABLE nba_risk_engine_picks 
ADD CONSTRAINT nba_risk_engine_picks_player_role_check 
CHECK (player_role = ANY (ARRAY[
  'STAR', 
  'BALL_DOMINANT_STAR', 
  'SECONDARY_GUARD', 
  'WING', 
  'BIG'
]));