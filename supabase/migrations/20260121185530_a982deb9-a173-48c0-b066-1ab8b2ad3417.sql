-- Make user_id nullable for anonymous suggestions
ALTER TABLE draft_suggestions ALTER COLUMN user_id DROP NOT NULL;

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Logged in users can suggest" ON draft_suggestions;

-- Create new policy allowing anonymous inserts
CREATE POLICY "Anyone can suggest" ON draft_suggestions
  FOR INSERT
  WITH CHECK (true);