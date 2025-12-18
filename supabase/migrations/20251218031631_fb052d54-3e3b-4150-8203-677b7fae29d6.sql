-- Add email verification columns to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verification_sent_at timestamptz;

-- Create email verification codes table
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean DEFAULT false,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own verification codes
CREATE POLICY "Users can view own email codes" ON email_verification_codes
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Users can insert their own verification codes
CREATE POLICY "Users can insert own email codes" ON email_verification_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own verification codes
CREATE POLICY "Users can update own email codes" ON email_verification_codes
  FOR UPDATE USING (auth.uid() = user_id);

-- Policy: Users can delete their own verification codes
CREATE POLICY "Users can delete own email codes" ON email_verification_codes
  FOR DELETE USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_id ON email_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);