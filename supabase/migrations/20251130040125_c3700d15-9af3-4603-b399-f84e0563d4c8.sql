-- Add suggested_parlay_id to track which parlays came from AI suggestions
ALTER TABLE public.parlay_history 
ADD COLUMN suggested_parlay_id uuid REFERENCES public.suggested_parlays(id) ON DELETE SET NULL;

-- Create suggestion performance tracking table
CREATE TABLE public.suggestion_performance (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  suggested_parlay_id uuid NOT NULL REFERENCES public.suggested_parlays(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  parlay_history_id uuid NOT NULL REFERENCES public.parlay_history(id) ON DELETE CASCADE,
  was_followed boolean NOT NULL DEFAULT true,
  outcome boolean, -- null = pending, true = won, false = lost
  stake numeric NOT NULL DEFAULT 0,
  payout numeric, -- actual payout if won
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  UNIQUE(suggested_parlay_id, parlay_history_id)
);

-- Enable RLS
ALTER TABLE public.suggestion_performance ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own suggestion performance"
ON public.suggestion_performance
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own suggestion performance"
ON public.suggestion_performance
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own suggestion performance"
ON public.suggestion_performance
FOR UPDATE
USING (auth.uid() = user_id);

-- Create aggregate performance stats view function
CREATE OR REPLACE FUNCTION public.get_suggestion_performance_stats(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  total_suggestions_followed integer,
  total_won integer,
  total_lost integer,
  total_pending integer,
  win_rate numeric,
  total_staked numeric,
  total_profit numeric,
  avg_confidence numeric,
  performance_by_sport jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::integer as total_suggestions_followed,
    COUNT(*) FILTER (WHERE sp.outcome = true)::integer as total_won,
    COUNT(*) FILTER (WHERE sp.outcome = false)::integer as total_lost,
    COUNT(*) FILTER (WHERE sp.outcome IS NULL)::integer as total_pending,
    CASE 
      WHEN COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE sp.outcome = true)::numeric / COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) * 100, 1)
      ELSE 0
    END as win_rate,
    COALESCE(SUM(sp.stake), 0) as total_staked,
    COALESCE(SUM(CASE WHEN sp.outcome = true THEN sp.payout - sp.stake WHEN sp.outcome = false THEN -sp.stake ELSE 0 END), 0) as total_profit,
    ROUND(AVG(sugp.confidence_score) * 100, 1) as avg_confidence,
    (
      SELECT jsonb_agg(sport_stats)
      FROM (
        SELECT jsonb_build_object(
          'sport', sugp2.sport,
          'total', COUNT(*),
          'won', COUNT(*) FILTER (WHERE sp2.outcome = true),
          'lost', COUNT(*) FILTER (WHERE sp2.outcome = false),
          'win_rate', CASE 
            WHEN COUNT(*) FILTER (WHERE sp2.outcome IS NOT NULL) > 0 
            THEN ROUND(COUNT(*) FILTER (WHERE sp2.outcome = true)::numeric / COUNT(*) FILTER (WHERE sp2.outcome IS NOT NULL) * 100, 1)
            ELSE 0
          END
        ) as sport_stats
        FROM suggestion_performance sp2
        JOIN suggested_parlays sugp2 ON sp2.suggested_parlay_id = sugp2.id
        WHERE (p_user_id IS NULL OR sp2.user_id = p_user_id)
        GROUP BY sugp2.sport
      ) sub
    ) as performance_by_sport
  FROM suggestion_performance sp
  JOIN suggested_parlays sugp ON sp.suggested_parlay_id = sugp.id
  WHERE (p_user_id IS NULL OR sp.user_id = p_user_id);
END;
$$;

-- Trigger to update suggestion_performance when parlay_history is settled
CREATE OR REPLACE FUNCTION public.update_suggestion_performance_on_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trigger when is_settled changes to true
  IF NEW.is_settled = true AND (OLD.is_settled = false OR OLD.is_settled IS NULL) THEN
    UPDATE suggestion_performance
    SET 
      outcome = NEW.is_won,
      payout = CASE WHEN NEW.is_won THEN NEW.potential_payout ELSE 0 END,
      settled_at = NOW()
    WHERE parlay_history_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_suggestion_performance
AFTER UPDATE ON public.parlay_history
FOR EACH ROW
EXECUTE FUNCTION public.update_suggestion_performance_on_settle();

-- Index for faster lookups
CREATE INDEX idx_suggestion_performance_user_id ON public.suggestion_performance(user_id);
CREATE INDEX idx_suggestion_performance_suggested_parlay_id ON public.suggestion_performance(suggested_parlay_id);
CREATE INDEX idx_parlay_history_suggested_parlay_id ON public.parlay_history(suggested_parlay_id);