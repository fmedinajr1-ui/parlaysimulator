
-- Schedule pitcher K analyzer: 11:00 AM ET (15:00 UTC) and 3:00 PM ET (19:00 UTC)
SELECT cron.schedule(
  'mlb-pitcher-k-analyzer-morning',
  '0 15 * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/mlb-pitcher-k-analyzer',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'mlb-pitcher-k-analyzer-afternoon',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/mlb-pitcher-k-analyzer',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
