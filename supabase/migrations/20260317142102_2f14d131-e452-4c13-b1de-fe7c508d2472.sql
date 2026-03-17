ALTER TABLE public.notification_preferences
ADD COLUMN IF NOT EXISTS push_slate_advisory boolean NOT NULL DEFAULT true;