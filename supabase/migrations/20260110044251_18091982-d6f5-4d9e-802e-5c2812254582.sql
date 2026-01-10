-- Delete heat_parlays from Jan 10 that would conflict with Jan 9
DELETE FROM heat_parlays
WHERE parlay_date = '2026-01-10'
  AND created_at >= '2026-01-10 03:00:00+00'
  AND created_at < '2026-01-10 12:00:00+00'
  AND (parlay_type, engine_version) IN (
    SELECT parlay_type, engine_version FROM heat_parlays WHERE parlay_date = '2026-01-09'
  );

-- Delete heat_parlays from Jan 9 that would conflict with Jan 8
DELETE FROM heat_parlays
WHERE parlay_date = '2026-01-09'
  AND created_at >= '2026-01-09 03:00:00+00'
  AND created_at < '2026-01-09 12:00:00+00'
  AND (parlay_type, engine_version) IN (
    SELECT parlay_type, engine_version FROM heat_parlays WHERE parlay_date = '2026-01-08'
  );

-- Delete sharp_ai_parlays from Jan 10 that would conflict with Jan 9
DELETE FROM sharp_ai_parlays
WHERE parlay_date = '2026-01-10'
  AND created_at >= '2026-01-10 03:00:00+00'
  AND created_at < '2026-01-10 12:00:00+00';

-- Delete sharp_ai_parlays from Jan 9 that would conflict with Jan 8
DELETE FROM sharp_ai_parlays
WHERE parlay_date = '2026-01-09'
  AND created_at >= '2026-01-09 03:00:00+00'
  AND created_at < '2026-01-09 12:00:00+00';