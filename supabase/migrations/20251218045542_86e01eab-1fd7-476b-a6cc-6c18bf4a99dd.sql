-- Add NFL-specific coaching tendency columns
ALTER TABLE public.coach_profiles 
ADD COLUMN IF NOT EXISTS run_pass_tendency text,
ADD COLUMN IF NOT EXISTS fourth_down_aggression text,
ADD COLUMN IF NOT EXISTS garbage_time_behavior text,
ADD COLUMN IF NOT EXISTS qb_usage_style text,
ADD COLUMN IF NOT EXISTS red_zone_tendency text;

-- Add NHL-specific coaching tendency columns
ALTER TABLE public.coach_profiles 
ADD COLUMN IF NOT EXISTS line_matching text,
ADD COLUMN IF NOT EXISTS goalie_pull_tendency text,
ADD COLUMN IF NOT EXISTS pp_aggression text,
ADD COLUMN IF NOT EXISTS empty_net_tendency text;

-- Add MLB-specific coaching tendency columns
ALTER TABLE public.coach_profiles 
ADD COLUMN IF NOT EXISTS bullpen_usage text,
ADD COLUMN IF NOT EXISTS lineup_consistency text,
ADD COLUMN IF NOT EXISTS platoon_tendency text,
ADD COLUMN IF NOT EXISTS pinch_hit_frequency text;

-- Add comments for documentation
COMMENT ON COLUMN public.coach_profiles.run_pass_tendency IS 'NFL: pass_heavy, run_heavy, balanced';
COMMENT ON COLUMN public.coach_profiles.fourth_down_aggression IS 'NFL: aggressive, moderate, conservative';
COMMENT ON COLUMN public.coach_profiles.garbage_time_behavior IS 'NFL: rests_starters, plays_through, situational';
COMMENT ON COLUMN public.coach_profiles.qb_usage_style IS 'NFL: pocket_passer, scramble_friendly, dual_threat';
COMMENT ON COLUMN public.coach_profiles.red_zone_tendency IS 'NFL: pass_heavy, run_heavy, balanced';
COMMENT ON COLUMN public.coach_profiles.line_matching IS 'NHL: heavy, moderate, minimal';
COMMENT ON COLUMN public.coach_profiles.goalie_pull_tendency IS 'NHL: early, normal, late';
COMMENT ON COLUMN public.coach_profiles.pp_aggression IS 'NHL: aggressive, moderate, conservative';
COMMENT ON COLUMN public.coach_profiles.empty_net_tendency IS 'NHL: aggressive, normal, conservative';
COMMENT ON COLUMN public.coach_profiles.bullpen_usage IS 'MLB: heavy, moderate, starter_focused';
COMMENT ON COLUMN public.coach_profiles.lineup_consistency IS 'MLB: very_consistent, moderate, platoon_heavy';
COMMENT ON COLUMN public.coach_profiles.platoon_tendency IS 'MLB: heavy, moderate, minimal';
COMMENT ON COLUMN public.coach_profiles.pinch_hit_frequency IS 'MLB: high, moderate, low';