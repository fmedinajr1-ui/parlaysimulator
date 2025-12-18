-- Add column to track when verification code was sent (for rate limiting)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS phone_verification_sent_at TIMESTAMP WITH TIME ZONE;