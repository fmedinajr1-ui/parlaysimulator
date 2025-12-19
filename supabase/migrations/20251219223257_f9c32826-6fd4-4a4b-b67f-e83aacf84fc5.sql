-- Add unique constraint on cron_job_history to fix ON CONFLICT errors
-- The constraint ensures we can properly track job runs with upsert logic
ALTER TABLE public.cron_job_history 
ADD CONSTRAINT cron_job_history_job_name_started_at_key 
UNIQUE (job_name, started_at);