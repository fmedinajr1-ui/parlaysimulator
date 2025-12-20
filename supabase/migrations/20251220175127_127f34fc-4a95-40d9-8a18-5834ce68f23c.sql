-- First, remove any duplicate records keeping the most recent one
DELETE FROM player_prop_hitrates a
USING player_prop_hitrates b
WHERE a.id < b.id 
  AND a.player_name = b.player_name 
  AND a.prop_type = b.prop_type 
  AND a.current_line = b.current_line;

-- Add unique constraint for combo props upsert
ALTER TABLE player_prop_hitrates 
ADD CONSTRAINT player_prop_hitrates_player_prop_line_unique 
UNIQUE (player_name, prop_type, current_line);