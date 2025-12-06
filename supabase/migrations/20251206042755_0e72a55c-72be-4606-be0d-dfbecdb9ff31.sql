-- Create table to track cron job execution history
CREATE TABLE public.cron_job_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'running',
  result JSONB,
  error_message TEXT,
  duration_ms INTEGER
);

-- Enable RLS
ALTER TABLE public.cron_job_history ENABLE ROW LEVEL SECURITY;

-- Allow admins to view all history
CREATE POLICY "Admins can view cron history"
ON public.cron_job_history
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for faster queries
CREATE INDEX idx_cron_job_history_job_name ON public.cron_job_history(job_name);
CREATE INDEX idx_cron_job_history_started_at ON public.cron_job_history(started_at DESC);