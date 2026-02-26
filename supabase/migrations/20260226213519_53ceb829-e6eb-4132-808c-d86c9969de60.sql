DROP POLICY IF EXISTS "Anyone can view bot activity log" ON bot_activity_log;

CREATE POLICY "Only admins can view bot activity log"
ON bot_activity_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));