ALTER TABLE public.ai_generated_parlays ADD COLUMN IF NOT EXISTS legs_graded jsonb;
ALTER TABLE public.bot_daily_parlays ADD COLUMN IF NOT EXISTS legs_graded jsonb;