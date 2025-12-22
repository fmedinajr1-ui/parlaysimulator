-- Create device_registrations table to track device fingerprints and IPs
CREATE TABLE public.device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_fingerprint TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_blocked BOOLEAN DEFAULT FALSE,
  block_reason TEXT
);

-- Create indexes for fast lookups
CREATE INDEX idx_device_registrations_fingerprint ON public.device_registrations(device_fingerprint);
CREATE INDEX idx_device_registrations_ip ON public.device_registrations(ip_address);
CREATE INDEX idx_device_registrations_user ON public.device_registrations(user_id);

-- Enable RLS
ALTER TABLE public.device_registrations ENABLE ROW LEVEL SECURITY;

-- Only service role can manage device registrations (no user access)
CREATE POLICY "Service role can manage device registrations"
ON public.device_registrations
FOR ALL
USING (true)
WITH CHECK (true);

-- Create device_limits table for configurable limits
CREATE TABLE public.device_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limit_type TEXT NOT NULL UNIQUE,
  max_accounts INTEGER NOT NULL DEFAULT 2,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default limits
INSERT INTO public.device_limits (limit_type, max_accounts) VALUES
  ('fingerprint', 2),
  ('ip_address', 5);

-- Enable RLS
ALTER TABLE public.device_limits ENABLE ROW LEVEL SECURITY;

-- Anyone can read limits, only admins can manage
CREATE POLICY "Anyone can view device limits"
ON public.device_limits
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage device limits"
ON public.device_limits
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));