SELECT cron.unschedule('cleanup-old-line-movements');
SELECT cron.schedule(
  'cleanup-old-line-movements',
  '0 5 * * *',
  $$
  DELETE FROM trap_patterns WHERE original_movement_id IN (
    SELECT id FROM line_movements WHERE commence_time < NOW() - INTERVAL '6 hours'
  );
  DELETE FROM line_movements WHERE commence_time < NOW() - INTERVAL '6 hours';
  $$
);