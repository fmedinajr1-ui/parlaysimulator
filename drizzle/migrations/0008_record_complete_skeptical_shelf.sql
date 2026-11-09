CREATE TABLE public.research_skeptical_picks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 game_date date NOT NULL,
 player_name text NOT NULL,
 stat text NOT NULL CHECK (stat IN ('points','rebounds','assists','threes_made','pra')),
 side text NOT NULL CHECK (side IN ('over','under')),
 line numeric NOT NULL CHECK (line >= 0),
 odds integer,
 projection numeric NOT NULL,
 win_prob numeric NOT NULL CHECK (win_prob BETWEEN 0 AND 1),
 hits_l10 integer NOT NULL CHECK (hits_l10 BETWEEN 0 AND 10),
 games_l10 integer NOT NULL CHECK (games_l10 BETWEEN 1 AND 10 AND hits_l10 <= games_l10),
 history_l10 jsonb NOT NULL,
 warnings jsonb NOT NULL,
 trend text NOT NULL,
 model_version text NOT NULL,
 rank integer NOT NULL,
 event_label text NOT NULL,
 starts_at timestamptz NOT NULL,
 logged_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','push','void')),
 result_value numeric,
 settled_at timestamptz,
 UNIQUE (game_date,player_name,stat,side,model_version),
 CHECK (logged_at < starts_at)
);
GRANT ALL ON public.research_skeptical_picks TO service_role;
ALTER TABLE public.research_skeptical_picks ENABLE ROW LEVEL SECURITY;
CREATE INDEX research_skeptical_open ON public.research_skeptical_picks (game_date) WHERE status = 'open';