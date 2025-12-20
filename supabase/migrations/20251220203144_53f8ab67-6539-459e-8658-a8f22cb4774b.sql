-- Create parlay_pools table for social parlay pools
CREATE TABLE public.parlay_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  creator_id UUID NOT NULL,
  pool_name TEXT NOT NULL,
  num_legs_required INTEGER NOT NULL CHECK (num_legs_required BETWEEN 2 AND 20),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'settled', 'cancelled')),
  pool_rules JSONB DEFAULT '{}',
  combined_odds NUMERIC DEFAULT 0,
  stake_per_member NUMERIC DEFAULT 10,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  settled_at TIMESTAMP WITH TIME ZONE,
  is_won BOOLEAN
);

-- Create pool_legs table for individual leg submissions
CREATE TABLE public.pool_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.parlay_pools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  leg_index INTEGER NOT NULL,
  description TEXT NOT NULL,
  odds NUMERIC NOT NULL,
  bet_type TEXT NOT NULL,
  sport TEXT,
  event_id TEXT,
  player_name TEXT,
  prop_type TEXT,
  line NUMERIC,
  side TEXT,
  implied_probability NUMERIC,
  engine_source TEXT,
  engine_confidence NUMERIC,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'push', 'cancelled')),
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  settled_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(pool_id, leg_index)
);

-- Create pool_memberships table to track pool members
CREATE TABLE public.pool_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id UUID NOT NULL REFERENCES public.parlay_pools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('creator', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(pool_id, user_id)
);

-- Create pool_leaderboard_stats table for rankings
CREATE TABLE public.pool_leaderboard_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  total_pools_joined INTEGER DEFAULT 0,
  pools_won INTEGER DEFAULT 0,
  legs_submitted INTEGER DEFAULT 0,
  legs_won INTEGER DEFAULT 0,
  total_payout NUMERIC DEFAULT 0,
  total_staked NUMERIC DEFAULT 0,
  roi_percentage NUMERIC DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.parlay_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_leaderboard_stats ENABLE ROW LEVEL SECURITY;

-- RLS policies for parlay_pools
CREATE POLICY "Anyone can view open pools"
ON public.parlay_pools FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create pools"
ON public.parlay_pools FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Creators can update their pools"
ON public.parlay_pools FOR UPDATE
TO authenticated
USING (auth.uid() = creator_id);

-- RLS policies for pool_legs
CREATE POLICY "Pool members can view legs"
ON public.pool_legs FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.pool_memberships pm
    WHERE pm.pool_id = pool_legs.pool_id AND pm.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.parlay_pools pp
    WHERE pp.id = pool_legs.pool_id AND pp.status != 'open'
  )
);

CREATE POLICY "Members can submit legs to open pools"
ON public.pool_legs FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.pool_memberships pm
    WHERE pm.pool_id = pool_legs.pool_id AND pm.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1 FROM public.parlay_pools pp
    WHERE pp.id = pool_legs.pool_id AND pp.status = 'open'
  )
);

CREATE POLICY "Service role can update legs"
ON public.pool_legs FOR UPDATE
USING (true)
WITH CHECK (true);

-- RLS policies for pool_memberships
CREATE POLICY "Anyone can view pool memberships"
ON public.pool_memberships FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can join pools"
ON public.pool_memberships FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.parlay_pools pp
    WHERE pp.id = pool_id AND pp.status = 'open'
  )
);

-- RLS policies for pool_leaderboard_stats
CREATE POLICY "Anyone can view leaderboard stats"
ON public.pool_leaderboard_stats FOR SELECT
USING (true);

CREATE POLICY "Service role can manage leaderboard stats"
ON public.pool_leaderboard_stats FOR ALL
USING (true)
WITH CHECK (true);

-- Enable realtime for pools
ALTER PUBLICATION supabase_realtime ADD TABLE public.parlay_pools;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_legs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.pool_memberships;