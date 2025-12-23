-- Fix profiles RLS - restrict to viewing own profile only
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

-- Fix device_registrations RLS - service role only
DROP POLICY IF EXISTS "Service role can manage device registrations" ON public.device_registrations;

-- Only allow authenticated users to view their own device registrations
CREATE POLICY "Users can view own device registrations" ON public.device_registrations
  FOR SELECT USING (auth.uid() = user_id);

-- Fix function search paths for all mutable functions
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.has_role(uuid, app_role) SET search_path = public;

-- Update update_updated_at_column if it exists and doesn't have search_path
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER FUNCTION public.update_updated_at_column() SET search_path = public';
  END IF;
END $$;