-- Add UPDATE policy for hitrate_parlays so users can dismiss parlays
CREATE POLICY "Authenticated users can dismiss parlays"
ON public.hitrate_parlays
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);