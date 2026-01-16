-- Create player reliability scores table
CREATE TABLE public.player_reliability_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  
  -- Core metrics
  total_picks INTEGER DEFAULT 0,
  total_hits INTEGER DEFAULT 0,
  total_misses INTEGER DEFAULT 0,
  hit_rate NUMERIC,
  
  -- Rolling windows
  last_10_hits INTEGER DEFAULT 0,
  last_10_misses INTEGER DEFAULT 0,
  last_10_hit_rate NUMERIC,
  
  -- Reliability scoring (0-100)
  reliability_score NUMERIC DEFAULT 50,
  reliability_tier TEXT, -- 'elite', 'reliable', 'neutral', 'caution', 'avoid'
  
  -- Confidence adjustments
  confidence_modifier NUMERIC DEFAULT 0,
  should_block BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  
  -- Tracking
  last_pick_date DATE,
  last_outcome TEXT,
  streak INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(player_name, prop_type)
);

-- Enable RLS
ALTER TABLE public.player_reliability_scores ENABLE ROW LEVEL SECURITY;

-- Allow public read access (these are system-calculated metrics)
CREATE POLICY "Allow public read access to reliability scores"
ON public.player_reliability_scores FOR SELECT
USING (true);

-- Add reliability columns to nba_risk_engine_picks
ALTER TABLE public.nba_risk_engine_picks ADD COLUMN IF NOT EXISTS player_hit_rate NUMERIC;
ALTER TABLE public.nba_risk_engine_picks ADD COLUMN IF NOT EXISTS player_reliability_tier TEXT;
ALTER TABLE public.nba_risk_engine_picks ADD COLUMN IF NOT EXISTS reliability_modifier_applied NUMERIC DEFAULT 0;

-- Create function to calculate player reliability from prop_results_archive
CREATE OR REPLACE FUNCTION public.calculate_player_reliability()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rec RECORD;
  updated_count INTEGER := 0;
  blocked_count INTEGER := 0;
  elite_count INTEGER := 0;
BEGIN
  -- Aggregate from prop_results_archive
  FOR rec IN
    SELECT 
      player_name,
      prop_type,
      COUNT(*) as total_picks,
      COUNT(CASE WHEN outcome = 'hit' THEN 1 END) as hits,
      COUNT(CASE WHEN outcome = 'miss' THEN 1 END) as misses,
      ROUND(COUNT(CASE WHEN outcome = 'hit' THEN 1 END)::numeric / 
            NULLIF(COUNT(CASE WHEN outcome IS NOT NULL THEN 1 END), 0) * 100, 1) as hit_rate,
      MAX(game_date) as last_pick_date
    FROM prop_results_archive
    WHERE outcome IS NOT NULL
    GROUP BY player_name, prop_type
    HAVING COUNT(*) >= 3
  LOOP
    DECLARE
      v_reliability_score NUMERIC;
      v_tier TEXT;
      v_modifier NUMERIC;
      v_should_block BOOLEAN := FALSE;
      v_block_reason TEXT := NULL;
    BEGIN
      -- Base score from hit rate
      v_reliability_score := rec.hit_rate;
      
      -- Tier assignment with confidence modifiers
      IF rec.hit_rate >= 65 AND rec.total_picks >= 10 THEN
        v_tier := 'elite';
        v_modifier := 1.5;
        elite_count := elite_count + 1;
      ELSIF rec.hit_rate >= 55 AND rec.total_picks >= 5 THEN
        v_tier := 'reliable';
        v_modifier := 0.5;
      ELSIF rec.hit_rate >= 45 THEN
        v_tier := 'neutral';
        v_modifier := 0;
      ELSIF rec.hit_rate >= 35 THEN
        v_tier := 'caution';
        v_modifier := -0.5;
      ELSE
        v_tier := 'avoid';
        v_modifier := -1.5;
        IF rec.total_picks >= 5 AND rec.hit_rate < 25 THEN
          v_should_block := TRUE;
          v_block_reason := format('%s%% hit rate over %s picks', rec.hit_rate, rec.total_picks);
          blocked_count := blocked_count + 1;
        END IF;
      END IF;
      
      -- Upsert reliability score
      INSERT INTO player_reliability_scores 
        (player_name, prop_type, total_picks, total_hits, total_misses, hit_rate,
         reliability_score, reliability_tier, confidence_modifier, should_block, block_reason,
         last_pick_date, updated_at)
      VALUES 
        (rec.player_name, rec.prop_type, rec.total_picks, rec.hits, rec.misses, rec.hit_rate,
         v_reliability_score, v_tier, v_modifier, v_should_block, v_block_reason,
         rec.last_pick_date, NOW())
      ON CONFLICT (player_name, prop_type) DO UPDATE SET
        total_picks = EXCLUDED.total_picks,
        total_hits = EXCLUDED.total_hits,
        total_misses = EXCLUDED.total_misses,
        hit_rate = EXCLUDED.hit_rate,
        reliability_score = EXCLUDED.reliability_score,
        reliability_tier = EXCLUDED.reliability_tier,
        confidence_modifier = EXCLUDED.confidence_modifier,
        should_block = EXCLUDED.should_block,
        block_reason = EXCLUDED.block_reason,
        last_pick_date = EXCLUDED.last_pick_date,
        updated_at = NOW();
      
      updated_count := updated_count + 1;
    END;
  END LOOP;
  
  RETURN jsonb_build_object(
    'updated', updated_count,
    'elite_players', elite_count,
    'blocked_players', blocked_count
  );
END;
$$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_player_reliability_lookup 
ON player_reliability_scores(player_name, prop_type);

CREATE INDEX IF NOT EXISTS idx_player_reliability_tier 
ON player_reliability_scores(reliability_tier);