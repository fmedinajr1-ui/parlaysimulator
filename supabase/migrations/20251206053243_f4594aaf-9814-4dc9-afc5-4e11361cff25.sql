-- Create unified_props table for the AI pipeline
CREATE TABLE public.unified_props (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  game_description TEXT NOT NULL,
  commence_time TIMESTAMP WITH TIME ZONE NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  bookmaker TEXT NOT NULL,
  current_line NUMERIC NOT NULL,
  over_price NUMERIC,
  under_price NUMERIC,
  
  -- AI Scores (0-100 scale)
  hit_rate_score NUMERIC DEFAULT 0,
  sharp_money_score NUMERIC DEFAULT 0,
  upset_score NUMERIC DEFAULT 0,
  trap_score NUMERIC DEFAULT 0,
  fatigue_score NUMERIC DEFAULT 0,
  composite_score NUMERIC DEFAULT 0,
  
  -- Recommendations
  recommendation TEXT DEFAULT 'neutral', -- 'pick', 'fade', 'neutral'
  recommended_side TEXT, -- 'over', 'under', null
  confidence NUMERIC DEFAULT 0,
  
  -- Categorization
  category TEXT NOT NULL DEFAULT 'uncategorized', -- 'hitrate', 'sharp', 'upset', 'fade', 'juiced', 'suggested'
  
  -- Signal sources (which signals triggered this)
  signal_sources JSONB DEFAULT '[]'::jsonb,
  
  -- Tracking
  is_active BOOLEAN DEFAULT true,
  outcome TEXT DEFAULT 'pending', -- 'pending', 'won', 'lost'
  settled_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(event_id, player_name, prop_type, bookmaker)
);

-- Enable RLS
ALTER TABLE public.unified_props ENABLE ROW LEVEL SECURITY;

-- Anyone can view unified props
CREATE POLICY "Anyone can view unified props" 
ON public.unified_props 
FOR SELECT 
USING (true);

-- Add calibration_factor to upset_predictions if not exists
ALTER TABLE public.upset_predictions 
ADD COLUMN IF NOT EXISTS calibration_factor NUMERIC DEFAULT 1.0;

-- Add signal_sources to upset_predictions
ALTER TABLE public.upset_predictions 
ADD COLUMN IF NOT EXISTS signal_sources JSONB DEFAULT '[]'::jsonb;

-- Create index for efficient queries
CREATE INDEX idx_unified_props_category ON public.unified_props(category);
CREATE INDEX idx_unified_props_sport ON public.unified_props(sport);
CREATE INDEX idx_unified_props_active ON public.unified_props(is_active);
CREATE INDEX idx_unified_props_composite ON public.unified_props(composite_score DESC);
CREATE INDEX idx_unified_props_event ON public.unified_props(event_id);

-- Create function to update accuracy calibration for upsets
CREATE OR REPLACE FUNCTION public.update_upset_calibration()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calibration RECORD;
BEGIN
  -- Calculate calibration factors by confidence level
  FOR v_calibration IN
    SELECT 
      confidence,
      COUNT(*) FILTER (WHERE game_completed = true) as verified,
      COUNT(*) FILTER (WHERE was_upset = true) as correct,
      CASE 
        WHEN COUNT(*) FILTER (WHERE game_completed = true) >= 10 
        THEN COUNT(*) FILTER (WHERE was_upset = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE game_completed = true), 0)
        ELSE 0.5
      END as actual_rate
    FROM upset_predictions
    GROUP BY confidence
    HAVING COUNT(*) FILTER (WHERE game_completed = true) >= 5
  LOOP
    -- Update calibration factors for future predictions
    UPDATE upset_predictions
    SET calibration_factor = v_calibration.actual_rate / 0.5
    WHERE confidence = v_calibration.confidence
      AND game_completed = false;
  END LOOP;
END;
$$;

-- Create trigger for updated_at
CREATE TRIGGER update_unified_props_updated_at
BEFORE UPDATE ON public.unified_props
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();