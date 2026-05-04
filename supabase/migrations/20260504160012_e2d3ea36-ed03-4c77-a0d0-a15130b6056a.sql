-- Spike personal share token
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS spike_share_token text UNIQUE;

-- Backfill existing rows
UPDATE public.profiles
SET spike_share_token = replace(gen_random_uuid()::text, '-', '')
WHERE spike_share_token IS NULL;

-- Default for new rows
ALTER TABLE public.profiles
  ALTER COLUMN spike_share_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');

-- RPC: return current user's token, mint if missing
CREATE OR REPLACE FUNCTION public.get_my_spike_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  tok text;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT spike_share_token INTO tok FROM public.profiles WHERE user_id = uid;

  IF tok IS NULL THEN
    tok := replace(gen_random_uuid()::text, '-', '');
    -- Upsert in case profile row doesn't exist yet
    INSERT INTO public.profiles (user_id, spike_share_token)
    VALUES (uid, tok)
    ON CONFLICT (user_id) DO UPDATE
      SET spike_share_token = COALESCE(public.profiles.spike_share_token, EXCLUDED.spike_share_token)
    RETURNING spike_share_token INTO tok;
  END IF;

  RETURN tok;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_spike_token() TO authenticated;

-- RPC: resolve user_id by token (used server-side by edge function)
CREATE OR REPLACE FUNCTION public.resolve_spike_token(p_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.profiles WHERE spike_share_token = p_token LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_spike_token(text) TO authenticated, anon;