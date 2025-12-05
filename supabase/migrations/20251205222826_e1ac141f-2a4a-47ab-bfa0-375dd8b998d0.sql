-- Create approved_odds_users table for admin-approved users
CREATE TABLE public.approved_odds_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.approved_odds_users ENABLE ROW LEVEL SECURITY;

-- Admins can manage approved users
CREATE POLICY "Admins can manage approved users"
ON public.approved_odds_users
FOR ALL
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Users can check if their email is approved
CREATE POLICY "Users can check own approval status"
ON public.approved_odds_users
FOR SELECT
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Add hints_enabled to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hints_enabled BOOLEAN DEFAULT true;