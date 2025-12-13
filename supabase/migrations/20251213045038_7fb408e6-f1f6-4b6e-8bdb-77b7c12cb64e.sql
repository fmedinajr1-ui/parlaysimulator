-- Reset all parlays that were settled using stale data
-- These need to be re-verified with correct date matching
UPDATE ai_generated_parlays 
SET 
  outcome = 'pending',
  settled_at = NULL
WHERE 
  outcome IN ('won', 'lost')
  AND settled_at IS NOT NULL;