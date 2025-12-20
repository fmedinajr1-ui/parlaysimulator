-- Create user_bet_preferences table for Phase 4: User-Level Filtering
CREATE TABLE public.user_bet_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_sports TEXT[] DEFAULT ARRAY['nfl', 'nba', 'nhl', 'ncaab', 'mlb'],
  risk_tolerance TEXT DEFAULT 'medium' CHECK (risk_tolerance IN ('conservative', 'medium', 'aggressive')),
  include_god_mode BOOLEAN DEFAULT true,
  include_coaching_signals BOOLEAN DEFAULT true,
  include_fatigue_edge BOOLEAN DEFAULT true,
  max_odds INTEGER DEFAULT 500,
  min_sample_size INTEGER DEFAULT 20,
  min_accuracy_threshold NUMERIC DEFAULT 52.0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_bet_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "Users can view their own bet preferences"
ON public.user_bet_preferences
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own preferences
CREATE POLICY "Users can create their own bet preferences"
ON public.user_bet_preferences
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update their own bet preferences"
ON public.user_bet_preferences
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own preferences
CREATE POLICY "Users can delete their own bet preferences"
ON public.user_bet_preferences
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_user_bet_preferences_updated_at
BEFORE UPDATE ON public.user_bet_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for user lookups
CREATE INDEX idx_user_bet_preferences_user_id ON public.user_bet_preferences(user_id);