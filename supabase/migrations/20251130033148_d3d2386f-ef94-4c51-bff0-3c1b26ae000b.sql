
-- Create table for suggested parlays
CREATE TABLE public.suggested_parlays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  legs JSONB NOT NULL,
  total_odds NUMERIC NOT NULL,
  combined_probability NUMERIC NOT NULL,
  suggestion_reason TEXT NOT NULL,
  sport TEXT NOT NULL,
  confidence_score NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Enable RLS
ALTER TABLE public.suggested_parlays ENABLE ROW LEVEL SECURITY;

-- Users can view their own suggestions or global ones (where user_id is null)
CREATE POLICY "Users can view their suggestions" 
ON public.suggested_parlays 
FOR SELECT 
USING (user_id = auth.uid() OR user_id IS NULL);

-- Only system/edge functions can insert (via service role)
CREATE POLICY "Service role can manage suggestions" 
ON public.suggested_parlays 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_suggested_parlays_user_active ON public.suggested_parlays(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_suggested_parlays_expires ON public.suggested_parlays(expires_at);
