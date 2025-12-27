-- Add odds_tracker_access role for granular feature access
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'odds_tracker_access';