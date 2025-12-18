-- Drop existing function and recreate with new return type
DROP FUNCTION IF EXISTS public.get_all_users_admin();

-- Recreate get_all_users_admin function with phone and email verification data
CREATE OR REPLACE FUNCTION public.get_all_users_admin()
RETURNS TABLE (
  user_id uuid,
  email text,
  username text,
  avatar_url text,
  phone_number text,
  phone_verified boolean,
  email_verified boolean,
  total_wins integer,
  total_losses integer,
  total_staked numeric,
  lifetime_degenerate_score numeric,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  RETURN QUERY
  SELECT 
    p.user_id,
    COALESCE(p.email, u.email::text) as email,
    p.username,
    p.avatar_url,
    p.phone_number,
    COALESCE(p.phone_verified, false) as phone_verified,
    COALESCE(p.email_verified, false) as email_verified,
    p.total_wins,
    p.total_losses,
    p.total_staked,
    p.lifetime_degenerate_score,
    p.created_at
  FROM profiles p
  LEFT JOIN auth.users u ON p.user_id = u.id
  ORDER BY p.created_at DESC;
END;
$$;