
-- Add unique constraint on event_id for proper upserts
ALTER TABLE public.fatigue_edge_tracking ADD CONSTRAINT fatigue_edge_tracking_event_id_key UNIQUE (event_id);
