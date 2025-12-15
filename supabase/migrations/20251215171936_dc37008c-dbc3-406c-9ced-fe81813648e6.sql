-- Add unique constraint on median_lock_candidates for upserts
ALTER TABLE median_lock_candidates
ADD CONSTRAINT median_lock_candidates_player_date_prop_unique 
UNIQUE (player_name, slate_date, prop_type);