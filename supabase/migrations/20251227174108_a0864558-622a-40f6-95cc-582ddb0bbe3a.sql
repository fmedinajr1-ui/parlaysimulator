-- Add permissive RLS policy for authenticated users to update sharp_line_tracker
-- This ensures updates don't silently fail due to RLS restrictions

CREATE POLICY "Authenticated users can update sharp lines" 
ON sharp_line_tracker
FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);