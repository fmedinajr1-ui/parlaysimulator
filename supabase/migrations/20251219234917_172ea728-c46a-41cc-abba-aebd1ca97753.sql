-- Create phone verification audit table for tracking all verification attempts
CREATE TABLE public.phone_verification_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  event_type TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  ip_address TEXT,
  user_agent TEXT,
  code_age_seconds INTEGER,
  attempts_at_time INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for querying by user and time
CREATE INDEX idx_phone_verification_audit_user_id ON public.phone_verification_audit(user_id);
CREATE INDEX idx_phone_verification_audit_created_at ON public.phone_verification_audit(created_at DESC);
CREATE INDEX idx_phone_verification_audit_ip ON public.phone_verification_audit(ip_address);

-- Enable RLS
ALTER TABLE public.phone_verification_audit ENABLE ROW LEVEL SECURITY;

-- Only service role can insert (from edge functions)
-- Users can view their own audit records
CREATE POLICY "Users can view their own verification audit" 
ON public.phone_verification_audit 
FOR SELECT 
USING (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE public.phone_verification_audit IS 'Audit log for phone verification attempts - used for security monitoring and abuse detection';