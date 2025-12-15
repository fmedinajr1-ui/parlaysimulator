-- Drop old constraint
ALTER TABLE median_lock_candidates 
DROP CONSTRAINT IF EXISTS median_lock_candidates_player_date_prop_unique;

-- Add new constraint including book_line for granular tracking
ALTER TABLE median_lock_candidates 
ADD CONSTRAINT median_lock_candidates_unique 
UNIQUE (player_name, slate_date, prop_type, book_line);