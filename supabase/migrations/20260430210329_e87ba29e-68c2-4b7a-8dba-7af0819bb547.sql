-- Player roles table
CREATE TABLE IF NOT EXISTS public.court_edge_player_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_slug text NOT NULL UNIQUE,
  player_name text NOT NULL,
  archetype text NOT NULL CHECK (archetype IN (
    'big_server','aggressive_baseliner','counter_puncher','clay_grinder','serve_and_volleyer','all_court','unknown'
  )),
  serve_tier text NOT NULL DEFAULT 'avg' CHECK (serve_tier IN ('elite','good','avg')),
  clay_score numeric(3,2) NOT NULL DEFAULT 0.50,
  grass_score numeric(3,2) NOT NULL DEFAULT 0.50,
  hard_score numeric(3,2) NOT NULL DEFAULT 0.50,
  notes text,
  source text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.court_edge_player_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage court_edge_player_roles"
  ON public.court_edge_player_roles
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_court_edge_player_roles_slug ON public.court_edge_player_roles(player_slug);

-- Pick table extensions
ALTER TABLE public.court_edge_picks
  ADD COLUMN IF NOT EXISTS role_home text,
  ADD COLUMN IF NOT EXISTS role_away text,
  ADD COLUMN IF NOT EXISTS role_adj_home numeric(5,2),
  ADD COLUMN IF NOT EXISTS role_adj_away numeric(5,2),
  ADD COLUMN IF NOT EXISTS role_reasons jsonb,
  ADD COLUMN IF NOT EXISTS drilldown_text text;

-- L3 cache extension
ALTER TABLE public.court_edge_l3_cache
  ADD COLUMN IF NOT EXISTS inferred_role text;

-- Seed a small starter set of well-known players
INSERT INTO public.court_edge_player_roles (player_slug, player_name, archetype, serve_tier, clay_score, grass_score, hard_score, notes) VALUES
  ('NovakDjokovic','Novak Djokovic','all_court','good',0.92,0.90,0.95,'GOAT-tier returner, all surfaces'),
  ('CarlosAlcaraz','Carlos Alcaraz','aggressive_baseliner','good',0.92,0.92,0.93,'Explosive, surface-agnostic'),
  ('JannikSinner','Jannik Sinner','aggressive_baseliner','good',0.85,0.80,0.95,'Best on hard, improving on clay'),
  ('DaniilMedvedev','Daniil Medvedev','counter_puncher','good',0.55,0.60,0.92,'Long rallies, struggles on clay'),
  ('AlexanderZverev','Alexander Zverev','aggressive_baseliner','elite',0.85,0.75,0.85,'Big serve, baseliner'),
  ('CasperRuud','Casper Ruud','clay_grinder','avg',0.90,0.55,0.70,'Clay specialist'),
  ('StefanosTsitsipas','Stefanos Tsitsipas','aggressive_baseliner','good',0.85,0.65,0.78,'Loves clay, weaker fast courts'),
  ('AndreyRublev','Andrey Rublev','aggressive_baseliner','good',0.78,0.70,0.82,'First-strike tennis'),
  ('HubertHurkacz','Hubert Hurkacz','big_server','elite',0.55,0.85,0.78,'Huge serve, weak on clay'),
  ('TaylorFritz','Taylor Fritz','big_server','elite',0.55,0.78,0.80,'Big serve, hard-court specialist'),
  ('FrancesTiafoe','Frances Tiafoe','all_court','good',0.65,0.75,0.78,'Athletic, all-court'),
  ('TommyPaul','Tommy Paul','all_court','avg',0.70,0.72,0.78,'Crafty all-court'),
  ('HollgerRune','Holger Rune','aggressive_baseliner','good',0.80,0.68,0.78,'Explosive baseliner'),
  ('GrigorDimitrov','Grigor Dimitrov','all_court','good',0.72,0.78,0.78,'Smooth all-court'),
  ('BenShelton','Ben Shelton','big_server','elite',0.50,0.78,0.78,'Lefty cannon serve'),
  ('FelixAugerAliassime','Felix Auger-Aliassime','big_server','elite',0.65,0.78,0.78,'Big serve'),
  ('MattBerrettini','Matteo Berrettini','big_server','elite',0.55,0.88,0.75,'Huge serve, grass killer'),
  ('NickKyrgios','Nick Kyrgios','serve_and_volleyer','elite',0.45,0.88,0.75,'Rare S&V style'),
  ('IgaSwiatek','Iga Swiatek','aggressive_baseliner','good',0.96,0.72,0.88,'Clay queen'),
  ('ArynaSabalenka','Aryna Sabalenka','aggressive_baseliner','elite',0.78,0.78,0.90,'Power baseliner'),
  ('CocoGauff','Coco Gauff','counter_puncher','good',0.80,0.78,0.85,'Defense + speed'),
  ('ElenaRybakina','Elena Rybakina','big_server','elite',0.72,0.88,0.85,'Serve-driven'),
  ('JessicaPegula','Jessica Pegula','counter_puncher','avg',0.72,0.72,0.82,'Consistent counter-puncher'),
  ('OnsJabeur','Ons Jabeur','all_court','avg',0.78,0.85,0.78,'Variety, slice, drop shots'),
  ('MariaSakkari','Maria Sakkari','aggressive_baseliner','good',0.75,0.70,0.78,'Power, fitness'),
  ('BarboraKrejcikova','Barbora Krejcikova','all_court','avg',0.85,0.78,0.75,'Doubles touch, all-court'),
  ('JelenaOstapenko','Jelena Ostapenko','aggressive_baseliner','good',0.72,0.82,0.75,'High-risk first strikes'),
  ('PaulaBadosa','Paula Badosa','aggressive_baseliner','good',0.80,0.65,0.75,'Power baseliner'),
  ('KarolinaMuchova','Karolina Muchova','all_court','avg',0.78,0.75,0.78,'Variety, all-court'),
  ('QinwenZheng','Qinwen Zheng','aggressive_baseliner','good',0.72,0.70,0.85,'Power, hard-court strong')
ON CONFLICT (player_slug) DO NOTHING;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_court_edge_player_roles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_court_edge_player_roles_touch ON public.court_edge_player_roles;
CREATE TRIGGER trg_court_edge_player_roles_touch
  BEFORE UPDATE ON public.court_edge_player_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_court_edge_player_roles_updated_at();