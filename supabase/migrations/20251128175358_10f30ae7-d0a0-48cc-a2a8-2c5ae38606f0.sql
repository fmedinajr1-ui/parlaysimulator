-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create secure role checking function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Admins can manage all roles
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Users can view their own role
CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Create email subscribers table
CREATE TABLE public.email_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subscribed_at timestamptz DEFAULT now(),
  is_subscribed boolean DEFAULT true,
  source text DEFAULT 'app'
);

-- Enable RLS on email_subscribers
ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can subscribe
CREATE POLICY "Anyone can subscribe" ON public.email_subscribers
  FOR INSERT TO authenticated WITH CHECK (true);

-- Users can view and manage their own subscription
CREATE POLICY "Users can view own subscription" ON public.email_subscribers
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

CREATE POLICY "Users can update own subscription" ON public.email_subscribers
  FOR UPDATE TO authenticated USING (user_id = auth.uid() OR email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Admins can view all subscribers
CREATE POLICY "Admins can view all subscribers" ON public.email_subscribers
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Add game time tracking columns to parlay_history
ALTER TABLE public.parlay_history 
  ADD COLUMN IF NOT EXISTS event_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS all_games_started boolean DEFAULT false;

-- Add game tracking columns to parlay_training_data  
ALTER TABLE public.parlay_training_data
  ADD COLUMN IF NOT EXISTS event_id text,
  ADD COLUMN IF NOT EXISTS event_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS event_status text DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS event_result text DEFAULT 'pending';

-- Create function to get all parlays (admin only)
CREATE OR REPLACE FUNCTION public.get_all_parlays_admin()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  legs jsonb,
  stake numeric,
  potential_payout numeric,
  combined_probability numeric,
  degenerate_level text,
  is_settled boolean,
  is_won boolean,
  created_at timestamptz,
  event_start_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  RETURN QUERY
  SELECT 
    ph.id,
    ph.user_id,
    p.username,
    ph.legs,
    ph.stake,
    ph.potential_payout,
    ph.combined_probability,
    ph.degenerate_level,
    ph.is_settled,
    ph.is_won,
    ph.created_at,
    ph.event_start_time
  FROM parlay_history ph
  LEFT JOIN profiles p ON ph.user_id = p.user_id
  ORDER BY ph.created_at DESC;
END;
$$;

-- Create function to get all users (admin only)
CREATE OR REPLACE FUNCTION public.get_all_users_admin()
RETURNS TABLE (
  user_id uuid,
  email text,
  username text,
  avatar_url text,
  total_wins integer,
  total_losses integer,
  total_staked numeric,
  lifetime_degenerate_score numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  RETURN QUERY
  SELECT 
    p.user_id,
    u.email,
    p.username,
    p.avatar_url,
    p.total_wins,
    p.total_losses,
    p.total_staked,
    p.lifetime_degenerate_score,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON p.user_id = u.id
  ORDER BY p.created_at DESC;
END;
$$;