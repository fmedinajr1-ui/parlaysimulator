CREATE TABLE public.research_skeptical_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_date date NOT NULL,
 player_name text NOT NULL,
 stat text NOT NULL CHECK (stat IN ('points','rebounds','assists','threes_made','pra')),
 side text NOT NULL CHECK (side IN ('over','under')),
 line numeric NOT NULL,
 odds integer,
 projection numeric NOT NULL,
 win_prob numeric NOT NULL CHECK (win_prob BETWEEN 0 AND 1),
 hits_l10 integer NOT NULL,
 games_l10 integer NOT NULL CHECK (games_l10 BETWEEN 1 AND 10 AND hits_l10 BETWEEN 0 AND games_l10),
 warnings jsonb NOT NULL,
 trend text NOT NULL,
 model_version text NOT NULL,
 rank integer NOT NULL,
 event_id text,
 event_label text,
 status text NOT NULL CHECK (status IN ('open','won','lost','push','void')),
 result_value numeric,
 result_source text NOT NULL,
 logged_at timestamptz NOT NULL DEFAULT now(),
 record_kind text NOT NULL DEFAULT 'retrospective' CHECK (record_kind = 'retrospective'),
 UNIQUE (game_date,player_name,stat,side,model_version)
);
GRANT ALL ON public.research_skeptical_reviews TO service_role;
REVOKE ALL ON public.research_skeptical_reviews FROM anon, authenticated;
ALTER TABLE public.research_skeptical_reviews ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.research_skeptical_reviews IS 'After-game captured skeptical shelf, not verified pregame probabilities or prospective accuracy. Results verified against final ESPN box scores.';