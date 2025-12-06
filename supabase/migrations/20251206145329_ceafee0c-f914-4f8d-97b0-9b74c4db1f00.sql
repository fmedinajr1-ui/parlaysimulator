-- Add juiced_picks_email column to notification_preferences
ALTER TABLE public.notification_preferences 
ADD COLUMN juiced_picks_email boolean NOT NULL DEFAULT true;

-- Add last_juiced_email_at column to track email frequency
ALTER TABLE public.notification_preferences 
ADD COLUMN last_juiced_email_at timestamp with time zone;