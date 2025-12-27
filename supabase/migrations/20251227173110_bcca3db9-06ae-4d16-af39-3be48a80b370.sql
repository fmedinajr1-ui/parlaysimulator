-- Fix the collaborators UPDATE policy to include WITH CHECK clause
DROP POLICY IF EXISTS "Collaborators can update sharp lines" ON sharp_line_tracker;

CREATE POLICY "Collaborators can update sharp lines" ON sharp_line_tracker
  FOR UPDATE 
  TO authenticated 
  USING (is_collaborator(auth.uid()))
  WITH CHECK (is_collaborator(auth.uid()));