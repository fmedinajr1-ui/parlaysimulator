
-- Create the scout_active_game table for admin-controlled game streaming
CREATE TABLE public.scout_active_game (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  game_description text,
  commence_time timestamptz,
  set_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scout_active_game ENABLE ROW LEVEL SECURITY;

-- Anyone can read the active game
CREATE POLICY "Anyone can read active game"
  ON public.scout_active_game FOR SELECT
  USING (true);

-- Only admins can manage (insert/update/delete) the active game
CREATE POLICY "Admins can manage active game"
  ON public.scout_active_game FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
  );
