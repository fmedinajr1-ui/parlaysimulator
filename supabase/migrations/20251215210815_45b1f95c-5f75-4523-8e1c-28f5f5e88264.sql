-- Add 'pilot' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pilot';

-- Create pilot_user_quotas table
CREATE TABLE public.pilot_user_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  free_scans_remaining INTEGER NOT NULL DEFAULT 5,
  free_compares_remaining INTEGER NOT NULL DEFAULT 3,
  paid_scan_balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pilot_user_quotas ENABLE ROW LEVEL SECURITY;

-- Users can only view their own quotas
CREATE POLICY "Users can view own quotas" 
ON public.pilot_user_quotas 
FOR SELECT 
USING (auth.uid() = user_id);

-- Create function to auto-assign pilot role and quotas on signup
CREATE OR REPLACE FUNCTION public.handle_new_pilot_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assign pilot role to new user
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'pilot')
  ON CONFLICT (user_id, role) DO NOTHING;
  
  -- Create quota row for new user
  INSERT INTO public.pilot_user_quotas (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
DROP TRIGGER IF EXISTS on_auth_user_created_pilot ON auth.users;
CREATE TRIGGER on_auth_user_created_pilot
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_pilot_user();

-- Function to decrement pilot quota
CREATE OR REPLACE FUNCTION public.decrement_pilot_quota(p_user_id UUID, p_quota_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_free_remaining INTEGER;
  v_paid_balance INTEGER;
BEGIN
  -- Get current quotas
  SELECT free_scans_remaining, paid_scan_balance
  INTO v_free_remaining, v_paid_balance
  FROM pilot_user_quotas
  WHERE user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No quota record found');
  END IF;
  
  IF p_quota_type = 'scan' THEN
    -- Try free scans first, then paid
    IF v_free_remaining > 0 THEN
      UPDATE pilot_user_quotas
      SET free_scans_remaining = free_scans_remaining - 1, updated_at = now()
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', true, 'used', 'free');
    ELSIF v_paid_balance > 0 THEN
      UPDATE pilot_user_quotas
      SET paid_scan_balance = paid_scan_balance - 1, updated_at = now()
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', true, 'used', 'paid');
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'No scans remaining');
    END IF;
  ELSIF p_quota_type = 'compare' THEN
    IF v_free_remaining > 0 THEN
      UPDATE pilot_user_quotas
      SET free_compares_remaining = free_compares_remaining - 1, updated_at = now()
      WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', true, 'used', 'free');
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'No compares remaining');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid quota type');
  END IF;
END;
$$;

-- Function to add paid scans
CREATE OR REPLACE FUNCTION public.add_paid_scans(p_user_id UUID, p_amount INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pilot_user_quotas
  SET paid_scan_balance = paid_scan_balance + p_amount, updated_at = now()
  WHERE user_id = p_user_id;
  
  RETURN FOUND;
END;
$$;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_pilot_quotas_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_pilot_quotas_timestamp
  BEFORE UPDATE ON public.pilot_user_quotas
  FOR EACH ROW EXECUTE FUNCTION public.update_pilot_quotas_updated_at();