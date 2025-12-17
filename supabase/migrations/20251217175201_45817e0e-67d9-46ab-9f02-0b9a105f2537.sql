-- Create projection_updates table to track significant projection changes
CREATE TABLE IF NOT EXISTS public.projection_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  previous_projection NUMERIC,
  new_projection NUMERIC,
  change_percent NUMERIC,
  affected_line NUMERIC,
  previous_probability NUMERIC,
  new_probability NUMERIC,
  change_reason TEXT,
  sport TEXT DEFAULT 'NBA',
  is_significant BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.projection_updates ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (projection updates are public data)
CREATE POLICY "Anyone can view projection updates"
  ON public.projection_updates
  FOR SELECT
  USING (true);

-- Create policy for service role insert/update
CREATE POLICY "Service role can manage projection updates"
  ON public.projection_updates
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable realtime for projection tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.projection_updates;

-- Create index for faster queries
CREATE INDEX idx_projection_updates_player ON public.projection_updates(player_name, prop_type);
CREATE INDEX idx_projection_updates_created ON public.projection_updates(created_at DESC);
CREATE INDEX idx_projection_updates_significant ON public.projection_updates(is_significant) WHERE is_significant = true;

-- Create trigger function to notify on projection refresh
CREATE OR REPLACE FUNCTION public.notify_projection_refresh()
RETURNS TRIGGER AS $$
BEGIN
  -- Notify subscribers of new projection update
  PERFORM pg_notify('projection_refresh', json_build_object(
    'player_name', NEW.player_name,
    'prop_type', NEW.prop_type,
    'change_percent', NEW.change_percent,
    'is_significant', NEW.is_significant
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for projection updates
DROP TRIGGER IF EXISTS on_projection_update ON public.projection_updates;
CREATE TRIGGER on_projection_update
AFTER INSERT ON public.projection_updates
FOR EACH ROW EXECUTE FUNCTION public.notify_projection_refresh();