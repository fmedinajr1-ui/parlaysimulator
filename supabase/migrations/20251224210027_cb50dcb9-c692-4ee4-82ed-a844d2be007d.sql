-- Drop and recreate the admin parlays function to include slip_image_url
DROP FUNCTION IF EXISTS public.get_all_parlays_admin();

CREATE FUNCTION public.get_all_parlays_admin()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  username text,
  legs jsonb,
  stake numeric,
  potential_payout numeric,
  combined_probability numeric,
  degenerate_level text,
  is_settled boolean,
  is_won boolean,
  created_at timestamptz,
  event_start_time timestamptz,
  slip_image_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied: Admin role required';
  END IF;
  
  RETURN QUERY
  SELECT 
    ph.id,
    ph.user_id,
    p.username,
    ph.legs,
    ph.stake,
    ph.potential_payout,
    ph.combined_probability,
    ph.degenerate_level,
    ph.is_settled,
    ph.is_won,
    ph.created_at,
    ph.event_start_time,
    ph.slip_image_url
  FROM parlay_history ph
  LEFT JOIN profiles p ON ph.user_id = p.user_id
  ORDER BY ph.created_at DESC;
END;
$$;