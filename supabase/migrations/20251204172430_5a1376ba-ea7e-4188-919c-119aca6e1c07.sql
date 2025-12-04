-- Create function to check if user is collaborator or admin
CREATE OR REPLACE FUNCTION public.is_collaborator(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('collaborator', 'admin')
  )
$$;

-- Allow collaborators to view tracked props
CREATE POLICY "Collaborators can view sharp lines"
ON public.sharp_line_tracker
FOR SELECT
TO authenticated
USING (public.is_collaborator(auth.uid()));

-- Allow collaborators to update sharp lines (for manual updates)
CREATE POLICY "Collaborators can update sharp lines"
ON public.sharp_line_tracker
FOR UPDATE
TO authenticated
USING (public.is_collaborator(auth.uid()));