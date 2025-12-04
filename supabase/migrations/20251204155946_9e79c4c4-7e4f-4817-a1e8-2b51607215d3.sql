-- Add movement_bucket column to trap_patterns
ALTER TABLE trap_patterns 
ADD COLUMN IF NOT EXISTS movement_bucket TEXT;

-- Backfill existing records based on movement_size
UPDATE trap_patterns SET movement_bucket = 
  CASE 
    WHEN movement_size >= 50 THEN 'extreme'
    WHEN movement_size >= 30 THEN 'large'
    WHEN movement_size >= 15 THEN 'moderate'
    WHEN movement_size >= 10 THEN 'small'
    ELSE 'minimal'
  END
WHERE movement_bucket IS NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_trap_patterns_movement_bucket 
ON trap_patterns(sport, movement_bucket);

-- Create function to get historical accuracy by movement size
CREATE OR REPLACE FUNCTION get_movement_accuracy(
  p_sport TEXT,
  p_min_movement NUMERIC,
  p_max_movement NUMERIC
) RETURNS TABLE(
  total_patterns INTEGER,
  trap_count INTEGER,
  win_count INTEGER,
  trap_rate NUMERIC,
  recommendation TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total_patterns,
    COUNT(*) FILTER (WHERE confirmed_trap = true)::INTEGER as trap_count,
    COUNT(*) FILTER (WHERE confirmed_trap = false)::INTEGER as win_count,
    ROUND(COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / 
          NULLIF(COUNT(*), 0) * 100, 1) as trap_rate,
    CASE 
      WHEN COUNT(*) < 10 THEN 'INSUFFICIENT_DATA'
      WHEN COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / NULLIF(COUNT(*), 0) > 0.55 THEN 'FADE'
      WHEN COUNT(*) FILTER (WHERE confirmed_trap = true)::NUMERIC / NULLIF(COUNT(*), 0) < 0.35 THEN 'PICK'
      ELSE 'CAUTION'
    END as recommendation
  FROM trap_patterns
  WHERE sport = p_sport
    AND movement_size >= p_min_movement
    AND movement_size <= p_max_movement;
END;
$$;