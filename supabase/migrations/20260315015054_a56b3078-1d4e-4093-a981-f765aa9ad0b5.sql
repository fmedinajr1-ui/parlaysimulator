ALTER TABLE public.quarter_player_snapshots ADD COLUMN IF NOT EXISTS steals INT DEFAULT 0;
ALTER TABLE public.quarter_player_snapshots ADD COLUMN IF NOT EXISTS blocks INT DEFAULT 0;