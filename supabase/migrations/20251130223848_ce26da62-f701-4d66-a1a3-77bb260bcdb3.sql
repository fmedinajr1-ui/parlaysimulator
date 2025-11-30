-- Add tutorial_completed column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS tutorial_completed JSONB DEFAULT '{}'::jsonb;