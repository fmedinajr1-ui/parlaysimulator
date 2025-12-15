-- Add full_access to the app_role enum if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'full_access' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'app_role')) THEN
    ALTER TYPE public.app_role ADD VALUE 'full_access';
  END IF;
END $$;

-- Drop the old trigger and function with CASCADE
DROP TRIGGER IF EXISTS on_auth_user_created_pilot ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_pilot_user() CASCADE;

-- Create a new function that auto-creates pilot quotas for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_pilot_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Create quota row for new user with default values
  INSERT INTO public.pilot_user_quotas (user_id, free_scans_remaining, free_compares_remaining, paid_scan_balance)
  VALUES (NEW.id, 5, 3, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-create pilot quotas on user signup
CREATE TRIGGER on_auth_user_created_pilot_quota
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_pilot_quota();

-- Create quotas for existing users who don't have one
INSERT INTO public.pilot_user_quotas (user_id, free_scans_remaining, free_compares_remaining, paid_scan_balance)
SELECT id, 5, 3, 0 FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.pilot_user_quotas)
ON CONFLICT (user_id) DO NOTHING;