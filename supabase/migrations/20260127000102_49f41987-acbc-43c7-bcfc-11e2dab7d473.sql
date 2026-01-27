-- Add missing columns to whale_picks table
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS book_consensus NUMERIC;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS confidence_grade TEXT;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS divergence_pts NUMERIC DEFAULT 0;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS move_speed_pts NUMERIC DEFAULT 0;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS confirmation_pts NUMERIC DEFAULT 0;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS board_behavior_pts NUMERIC DEFAULT 0;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS recommended_side TEXT;
ALTER TABLE public.whale_picks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add missing columns to pp_snapshot table
ALTER TABLE public.pp_snapshot ADD COLUMN IF NOT EXISTS pp_projection_id TEXT;
ALTER TABLE public.pp_snapshot ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE public.pp_snapshot ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE public.pp_snapshot ADD COLUMN IF NOT EXISTS previous_line NUMERIC;
ALTER TABLE public.pp_snapshot ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_pp_snapshot_player_stat ON public.pp_snapshot (player_name, stat_type);
CREATE INDEX IF NOT EXISTS idx_pp_snapshot_captured_at ON public.pp_snapshot (captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_whale_picks_confidence ON public.whale_picks (confidence_grade);
CREATE INDEX IF NOT EXISTS idx_whale_picks_created ON public.whale_picks (created_at DESC);

-- Enable realtime for whale_picks if not already enabled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'whale_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whale_picks;
  END IF;
END $$;