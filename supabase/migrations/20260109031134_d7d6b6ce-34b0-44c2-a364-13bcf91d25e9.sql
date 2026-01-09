-- Create prop_engine_v2_picks table for Prop Engine v2.1
CREATE TABLE public.prop_engine_v2_picks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  line_structure TEXT NOT NULL DEFAULT '.0',
  side TEXT NOT NULL,
  ses_score INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT 'NO_BET',
  decision_emoji TEXT NOT NULL DEFAULT '🚫',
  key_reason TEXT,
  player_archetype TEXT,
  market_type TEXT DEFAULT 'Standard',
  rolling_median NUMERIC,
  median_gap NUMERIC,
  minutes_certainty TEXT DEFAULT 'MEDIUM',
  blowout_risk BOOLEAN DEFAULT false,
  auto_fail_reason TEXT,
  ses_components JSONB DEFAULT '{}',
  game_date DATE NOT NULL DEFAULT CURRENT_DATE,
  event_id TEXT,
  team_name TEXT,
  opponent_name TEXT,
  odds NUMERIC,
  outcome TEXT DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.prop_engine_v2_picks ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access (engine picks are public)
CREATE POLICY "Prop Engine v2 picks are viewable by everyone" 
ON public.prop_engine_v2_picks 
FOR SELECT 
USING (true);

-- Create policy for service role insert/update
CREATE POLICY "Service role can manage prop engine v2 picks" 
ON public.prop_engine_v2_picks 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Create indexes for common queries
CREATE INDEX idx_prop_engine_v2_picks_game_date ON public.prop_engine_v2_picks(game_date DESC);
CREATE INDEX idx_prop_engine_v2_picks_decision ON public.prop_engine_v2_picks(decision);
CREATE INDEX idx_prop_engine_v2_picks_ses_score ON public.prop_engine_v2_picks(ses_score DESC);
CREATE INDEX idx_prop_engine_v2_picks_player ON public.prop_engine_v2_picks(player_name);

-- Create updated_at trigger
CREATE TRIGGER update_prop_engine_v2_picks_updated_at
BEFORE UPDATE ON public.prop_engine_v2_picks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.prop_engine_v2_picks;