-- Drop the table if it exists and recreate with correct schema
DROP TABLE IF EXISTS public.phone_verification_codes;

-- Create phone_verification_codes table with all required columns
CREATE TABLE public.phone_verification_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to manage their own verification codes
CREATE POLICY "Users can manage their own verification codes"
ON public.phone_verification_codes
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow service role full access (for edge functions)
CREATE POLICY "Service role has full access to verification codes"
ON public.phone_verification_codes
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_phone_verification_user_phone ON public.phone_verification_codes(user_id, phone_number);

-- Create cleanup function to delete expired codes
CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_codes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.phone_verification_codes
  WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$;