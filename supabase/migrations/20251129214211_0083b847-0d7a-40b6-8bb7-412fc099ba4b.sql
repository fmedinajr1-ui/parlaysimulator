-- Create subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'inactive',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create scan_usage table
CREATE TABLE public.scan_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  scan_count INTEGER DEFAULT 0,
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_usage ENABLE ROW LEVEL SECURITY;

-- Subscriptions RLS policies
CREATE POLICY "Users can view own subscription"
ON public.subscriptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription"
ON public.subscriptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription"
ON public.subscriptions FOR UPDATE
USING (auth.uid() = user_id);

-- Scan usage RLS policies
CREATE POLICY "Users can view own scan usage"
ON public.scan_usage FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scan usage"
ON public.scan_usage FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scan usage"
ON public.scan_usage FOR UPDATE
USING (auth.uid() = user_id);

-- Function to check scan access
CREATE OR REPLACE FUNCTION public.check_scan_access(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_is_subscribed BOOLEAN;
  v_scan_count INTEGER;
  v_can_scan BOOLEAN;
  v_scans_remaining INTEGER;
BEGIN
  -- Check if admin
  SELECT EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = p_user_id AND role = 'admin'
  ) INTO v_is_admin;
  
  -- Admins have unlimited access
  IF v_is_admin THEN
    RETURN jsonb_build_object(
      'canScan', true,
      'scansRemaining', -1,
      'isSubscribed', false,
      'isAdmin', true
    );
  END IF;
  
  -- Check subscription status
  SELECT EXISTS (
    SELECT 1 FROM subscriptions 
    WHERE user_id = p_user_id 
    AND status = 'active'
    AND (current_period_end IS NULL OR current_period_end > NOW())
  ) INTO v_is_subscribed;
  
  -- Subscribers have unlimited access
  IF v_is_subscribed THEN
    RETURN jsonb_build_object(
      'canScan', true,
      'scansRemaining', -1,
      'isSubscribed', true,
      'isAdmin', false
    );
  END IF;
  
  -- Get current scan count for free users
  SELECT COALESCE(scan_count, 0) INTO v_scan_count
  FROM scan_usage WHERE user_id = p_user_id;
  
  v_scans_remaining := GREATEST(0, 3 - COALESCE(v_scan_count, 0));
  v_can_scan := v_scans_remaining > 0;
  
  RETURN jsonb_build_object(
    'canScan', v_can_scan,
    'scansRemaining', v_scans_remaining,
    'isSubscribed', false,
    'isAdmin', false
  );
END;
$$;

-- Function to increment scan count
CREATE OR REPLACE FUNCTION public.increment_scan_count(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO scan_usage (user_id, scan_count, last_scan_at)
  VALUES (p_user_id, 1, NOW())
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    scan_count = scan_usage.scan_count + 1,
    last_scan_at = NOW();
END;
$$;

-- Trigger for updated_at on subscriptions
CREATE TRIGGER update_subscriptions_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();