-- Create app_releases table for storing release notes
CREATE TABLE public.app_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  release_type TEXT NOT NULL DEFAULT 'feature' CHECK (release_type IN ('feature', 'bugfix', 'improvement', 'major')),
  is_published BOOLEAN NOT NULL DEFAULT false,
  notifications_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  published_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

-- Anyone can view published releases
CREATE POLICY "Anyone can view published releases"
ON public.app_releases
FOR SELECT
USING (is_published = true);

-- Admins can manage all releases
CREATE POLICY "Admins can manage releases"
ON public.app_releases
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Add release notification preferences to notification_preferences table
ALTER TABLE public.notification_preferences 
ADD COLUMN IF NOT EXISTS release_notifications BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS push_release_notifications BOOLEAN NOT NULL DEFAULT true;