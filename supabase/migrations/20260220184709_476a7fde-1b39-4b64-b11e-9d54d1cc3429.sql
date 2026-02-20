
-- Add sport column to mispriced_lines
ALTER TABLE public.mispriced_lines ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'basketball_nba';

-- Drop old unique constraint and create new one including sport
ALTER TABLE public.mispriced_lines DROP CONSTRAINT IF EXISTS mispriced_lines_player_name_prop_type_analysis_date_key;
ALTER TABLE public.mispriced_lines ADD CONSTRAINT mispriced_lines_player_prop_date_sport_key UNIQUE (player_name, prop_type, analysis_date, sport);
