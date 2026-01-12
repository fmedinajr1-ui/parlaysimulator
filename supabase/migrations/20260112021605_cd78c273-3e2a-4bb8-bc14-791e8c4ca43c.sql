-- Create player_archetypes table for archetype classification
CREATE TABLE public.player_archetypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL UNIQUE,
  primary_archetype TEXT NOT NULL CHECK (primary_archetype IN (
    'ELITE_REBOUNDER', 'GLASS_CLEANER', 'PURE_SHOOTER', 'PLAYMAKER', 
    'COMBO_GUARD', 'TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER'
  )),
  secondary_archetype TEXT CHECK (secondary_archetype IN (
    'ELITE_REBOUNDER', 'GLASS_CLEANER', 'PURE_SHOOTER', 'PLAYMAKER', 
    'COMBO_GUARD', 'TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER', NULL
  )),
  archetype_confidence NUMERIC(3,2) DEFAULT 0.80,
  avg_points NUMERIC(4,1),
  avg_rebounds NUMERIC(4,1),
  avg_assists NUMERIC(4,1),
  avg_threes NUMERIC(4,1),
  avg_minutes NUMERIC(4,1),
  games_played INTEGER DEFAULT 0,
  manual_override BOOLEAN DEFAULT FALSE,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for player_archetypes
CREATE INDEX idx_player_archetypes_name ON public.player_archetypes(player_name);
CREATE INDEX idx_player_archetypes_type ON public.player_archetypes(primary_archetype);

-- Create matchup_history table for H2H analysis
CREATE TABLE public.matchup_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  opponent TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  games_played INTEGER DEFAULT 0,
  avg_stat NUMERIC(5,2),
  max_stat NUMERIC(5,2),
  min_stat NUMERIC(5,2),
  hit_rate_over NUMERIC(3,2) DEFAULT 0,
  hit_rate_under NUMERIC(3,2) DEFAULT 0,
  last_game_stat NUMERIC(5,2),
  last_game_date TEXT,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(player_name, opponent, prop_type)
);

-- Indexes for matchup_history
CREATE INDEX idx_matchup_history_player ON public.matchup_history(player_name);
CREATE INDEX idx_matchup_history_opponent ON public.matchup_history(opponent);
CREATE INDEX idx_matchup_history_lookup ON public.matchup_history(player_name, opponent);

-- Enable RLS
ALTER TABLE public.player_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_history ENABLE ROW LEVEL SECURITY;

-- Public read policies (engine data)
CREATE POLICY "Anyone can read player_archetypes" ON public.player_archetypes FOR SELECT USING (true);
CREATE POLICY "Anyone can read matchup_history" ON public.matchup_history FOR SELECT USING (true);

-- Service role insert/update policies
CREATE POLICY "Service can manage player_archetypes" ON public.player_archetypes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage matchup_history" ON public.matchup_history FOR ALL USING (true) WITH CHECK (true);