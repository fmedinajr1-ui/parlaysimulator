ALTER TABLE public.sharp_line_tracker DROP CONSTRAINT IF EXISTS sharp_line_tracker_sport_check;
ALTER TABLE public.sharp_line_tracker ADD CONSTRAINT sharp_line_tracker_sport_check CHECK (sport = ANY (ARRAY[
  'basketball_nba','basketball_wnba','baseball_mlb','americanfootball_nfl','americanfootball_ncaaf',
  'icehockey_nhl','tennis_atp','tennis_wta','soccer_epl','soccer_mls','soccer_ucl','soccer_laliga',
  'mma_mixed_martial_arts','golf'
]));
ALTER TABLE public.sharp_line_tracker DROP CONSTRAINT IF EXISTS sharp_line_tracker_ai_direction_check;
ALTER TABLE public.sharp_line_tracker ADD CONSTRAINT sharp_line_tracker_ai_direction_check CHECK (ai_direction IS NULL OR ai_direction = ANY (ARRAY['over'::text, 'under'::text]));