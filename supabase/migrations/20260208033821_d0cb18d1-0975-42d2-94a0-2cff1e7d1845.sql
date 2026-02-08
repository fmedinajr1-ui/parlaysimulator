-- Drop the foreign key constraint on sweet_spot_hedge_snapshots
-- The system uses composite key matching (player_name + prop_type + line + quarter + analysis_date)
-- instead of strict UUID foreign keys, as documented in the codebase

ALTER TABLE public.sweet_spot_hedge_snapshots 
DROP CONSTRAINT IF EXISTS sweet_spot_hedge_snapshots_sweet_spot_id_fkey;