CREATE TABLE public.bot_doctor_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date TEXT NOT NULL DEFAULT (now() AT TIME ZONE 'America/New_York')::date::text,
  trigger_source TEXT NOT NULL DEFAULT 'manual',
  problems_detected INTEGER NOT NULL DEFAULT 0,
  problems_auto_fixed INTEGER NOT NULL DEFAULT 0,
  diagnoses JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_remediations JSONB NOT NULL DEFAULT '[]'::jsonb,
  profit_impact_estimate NUMERIC DEFAULT NULL,
  failure_day_win_rate NUMERIC DEFAULT NULL,
  clean_day_win_rate NUMERIC DEFAULT NULL,
  pipeline_context JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_bot_doctor_reports_date ON public.bot_doctor_reports(report_date);
CREATE INDEX idx_bot_doctor_reports_created ON public.bot_doctor_reports(created_at);