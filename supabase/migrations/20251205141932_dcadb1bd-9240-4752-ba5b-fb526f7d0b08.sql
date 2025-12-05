-- Create table to track user sharp pick follows
CREATE TABLE public.user_sharp_follows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  line_movement_id UUID NOT NULL REFERENCES public.line_movements(id) ON DELETE CASCADE,
  followed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  stake NUMERIC DEFAULT 0,
  outcome_verified BOOLEAN DEFAULT false,
  outcome_correct BOOLEAN DEFAULT NULL,
  verified_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, line_movement_id)
);

-- Enable RLS
ALTER TABLE public.user_sharp_follows ENABLE ROW LEVEL SECURITY;

-- Users can view their own follows
CREATE POLICY "Users can view own sharp follows"
ON public.user_sharp_follows
FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own follows
CREATE POLICY "Users can insert own sharp follows"
ON public.user_sharp_follows
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own follows
CREATE POLICY "Users can update own sharp follows"
ON public.user_sharp_follows
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own follows
CREATE POLICY "Users can delete own sharp follows"
ON public.user_sharp_follows
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX idx_user_sharp_follows_user_id ON public.user_sharp_follows(user_id);
CREATE INDEX idx_user_sharp_follows_movement_id ON public.user_sharp_follows(line_movement_id);

-- Function to sync outcomes from line_movements
CREATE OR REPLACE FUNCTION public.sync_sharp_follow_outcomes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_sharp_follows usf
  SET 
    outcome_verified = lm.outcome_verified,
    outcome_correct = lm.outcome_correct,
    verified_at = CASE WHEN lm.outcome_verified AND usf.verified_at IS NULL THEN now() ELSE usf.verified_at END
  FROM line_movements lm
  WHERE usf.line_movement_id = lm.id
    AND lm.outcome_verified = true
    AND usf.outcome_verified = false;
END;
$$;

-- Function to get user sharp performance stats
CREATE OR REPLACE FUNCTION public.get_user_sharp_performance(p_user_id UUID)
RETURNS TABLE(
  total_follows INTEGER,
  total_verified INTEGER,
  total_wins INTEGER,
  total_losses INTEGER,
  win_rate NUMERIC,
  pending INTEGER,
  by_recommendation JSONB,
  by_confidence JSONB,
  recent_results JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH follow_stats AS (
    SELECT 
      usf.*,
      lm.recommendation,
      lm.authenticity_confidence
    FROM user_sharp_follows usf
    JOIN line_movements lm ON usf.line_movement_id = lm.id
    WHERE usf.user_id = p_user_id
  )
  SELECT 
    COUNT(*)::INTEGER as total_follows,
    COUNT(*) FILTER (WHERE fs.outcome_verified = true)::INTEGER as total_verified,
    COUNT(*) FILTER (WHERE fs.outcome_correct = true)::INTEGER as total_wins,
    COUNT(*) FILTER (WHERE fs.outcome_correct = false)::INTEGER as total_losses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE fs.outcome_verified = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE fs.outcome_correct = true)::NUMERIC / COUNT(*) FILTER (WHERE fs.outcome_verified = true) * 100, 1)
      ELSE 0
    END as win_rate,
    COUNT(*) FILTER (WHERE fs.outcome_verified = false OR fs.outcome_verified IS NULL)::INTEGER as pending,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'recommendation', sub.recommendation,
        'total', sub.total,
        'wins', sub.wins,
        'win_rate', sub.win_rate
      ))
      FROM (
        SELECT 
          recommendation,
          COUNT(*) FILTER (WHERE outcome_verified = true) as total,
          COUNT(*) FILTER (WHERE outcome_correct = true) as wins,
          CASE 
            WHEN COUNT(*) FILTER (WHERE outcome_verified = true) > 0 
            THEN ROUND(COUNT(*) FILTER (WHERE outcome_correct = true)::NUMERIC / COUNT(*) FILTER (WHERE outcome_verified = true) * 100, 1)
            ELSE 0
          END as win_rate
        FROM follow_stats
        WHERE recommendation IS NOT NULL
        GROUP BY recommendation
      ) sub
    ) as by_recommendation,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'bucket', sub.bucket,
        'total', sub.total,
        'wins', sub.wins,
        'win_rate', sub.win_rate
      ))
      FROM (
        SELECT 
          CASE 
            WHEN authenticity_confidence >= 0.8 THEN '80%+'
            WHEN authenticity_confidence >= 0.6 THEN '60-79%'
            ELSE '<60%'
          END as bucket,
          COUNT(*) FILTER (WHERE outcome_verified = true) as total,
          COUNT(*) FILTER (WHERE outcome_correct = true) as wins,
          CASE 
            WHEN COUNT(*) FILTER (WHERE outcome_verified = true) > 0 
            THEN ROUND(COUNT(*) FILTER (WHERE outcome_correct = true)::NUMERIC / COUNT(*) FILTER (WHERE outcome_verified = true) * 100, 1)
            ELSE 0
          END as win_rate
        FROM follow_stats
        GROUP BY CASE 
          WHEN authenticity_confidence >= 0.8 THEN '80%+'
          WHEN authenticity_confidence >= 0.6 THEN '60-79%'
          ELSE '<60%'
        END
      ) sub
    ) as by_confidence,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', sub.id,
        'outcome_correct', sub.outcome_correct,
        'followed_at', sub.followed_at
      ) ORDER BY sub.followed_at DESC)
      FROM (
        SELECT id, outcome_correct, followed_at
        FROM follow_stats
        WHERE outcome_verified = true
        ORDER BY followed_at DESC
        LIMIT 10
      ) sub
    ) as recent_results
  FROM follow_stats fs;
END;
$$;