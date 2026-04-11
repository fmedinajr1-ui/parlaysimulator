
CREATE TABLE IF NOT EXISTS public.mma_fighter_stats (
  id              bigserial PRIMARY KEY,
  fighter_name    text        NOT NULL,
  style           text,
  finish_rate     numeric(4,3),
  avg_rounds      numeric(4,2),
  wins            integer DEFAULT 0,
  losses          integer DEFAULT 0,
  draws           integer DEFAULT 0,
  ko_wins         integer DEFAULT 0,
  sub_wins        integer DEFAULT 0,
  dec_wins        integer DEFAULT 0,
  weight_class    text,
  is_ufc          boolean DEFAULT true,
  last_updated    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mma_fighter_stats_name_idx
  ON public.mma_fighter_stats (fighter_name);

ALTER TABLE public.mma_fighter_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_mma_fighter_stats" ON public.mma_fighter_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.mma_fighter_stats (fighter_name, style, finish_rate, avg_rounds, wins, losses, ko_wins, sub_wins, dec_wins, weight_class)
VALUES
  ('Jon Jones',           'all-around',  0.69, 2.1, 27,  1, 10,  6, 11, 'Heavyweight'),
  ('Francis Ngannou',     'striker',     0.85, 1.6, 17,  3, 12,  2,  3, 'Heavyweight'),
  ('Ciryl Gane',          'all-around',  0.58, 2.8, 12,  2,  5,  2,  5, 'Heavyweight'),
  ('Stipe Miocic',        'all-around',  0.62, 2.4, 20,  4, 12,  3,  5, 'Heavyweight'),
  ('Tom Aspinall',        'striker',     0.86, 1.5, 14,  3, 10,  2,  2, 'Heavyweight'),
  ('Sergei Pavlovich',    'striker',     0.92, 1.3, 18,  2, 17,  1,  0, 'Heavyweight'),
  ('Jiri Prochazka',      'striker',     0.87, 1.8, 30,  4, 24,  4,  2, 'Light Heavyweight'),
  ('Alex Pereira',        'striker',     0.90, 1.6, 12,  2, 11,  0,  1, 'Light Heavyweight'),
  ('Jamahal Hill',        'striker',     0.73, 2.1, 12,  4,  8,  1,  3, 'Light Heavyweight'),
  ('Magomed Ankalaev',    'all-around',  0.69, 2.4, 19,  1,  7,  6,  6, 'Light Heavyweight'),
  ('Israel Adesanya',     'striker',     0.55, 3.1, 24,  4,  9,  1, 14, 'Middleweight'),
  ('Sean Strickland',     'striker',     0.52, 3.3, 29,  5, 11,  2, 16, 'Middleweight'),
  ('Dricus du Plessis',   'all-around',  0.76, 2.2, 22,  2, 10,  7,  5, 'Middleweight'),
  ('Robert Whittaker',    'all-around',  0.62, 2.6, 26,  7, 13,  3, 10, 'Middleweight'),
  ('Paulo Costa',         'striker',     0.70, 2.1, 14,  3,  9,  1,  4, 'Middleweight'),
  ('Leon Edwards',        'all-around',  0.57, 2.7, 22,  3,  9,  3, 10, 'Welterweight'),
  ('Kamaru Usman',        'wrestler',    0.67, 2.5, 20,  3, 10,  4,  6, 'Welterweight'),
  ('Colby Covington',     'wrestler',    0.43, 3.6, 17,  4,  5,  2, 10, 'Welterweight'),
  ('Belal Muhammad',      'wrestler',    0.52, 3.1, 23,  3,  9,  3, 11, 'Welterweight'),
  ('Shavkat Rakhmonov',   'all-around',  1.00, 1.8, 18,  0, 10,  8,  0, 'Welterweight'),
  ('Jack Della Maddalena','striker',     0.86, 1.7, 17,  2, 12,  3,  2, 'Welterweight'),
  ('Islam Makhachev',     'grappler',    0.74, 2.2, 26,  1,  4, 16,  6, 'Lightweight'),
  ('Dustin Poirier',      'all-around',  0.74, 2.1, 30,  8, 15,  7,  8, 'Lightweight'),
  ('Justin Gaethje',      'striker',     0.71, 2.2, 24,  4, 15,  2,  7, 'Lightweight'),
  ('Charles Oliveira',    'grappler',    0.88, 1.9, 34,  9,  9, 21,  4, 'Lightweight'),
  ('Arman Tsarukyan',     'all-around',  0.64, 2.5, 22,  3, 10,  4,  8, 'Lightweight'),
  ('Michael Chandler',    'striker',     0.83, 1.9, 23,  8, 15,  5,  3, 'Lightweight'),
  ('Alexander Volkanovski','all-around', 0.65, 2.4, 26,  3, 12,  5,  9, 'Featherweight'),
  ('Ilia Topuria',         'striker',   0.95, 1.6, 15,  0, 11,  3,  1, 'Featherweight'),
  ('Brian Ortega',         'grappler',  0.83, 2.1, 16,  3,  6,  8,  2, 'Featherweight'),
  ('Yair Rodriguez',       'striker',   0.78, 2.0, 17,  4, 10,  4,  3, 'Featherweight'),
  ('Max Holloway',         'striker',   0.58, 2.9, 26,  7, 12,  3, 11, 'Featherweight'),
  ('Sean O''Malley',       'striker',   0.78, 1.9, 17,  1, 13,  0,  4, 'Bantamweight'),
  ('Merab Dvalishvili',    'wrestler',  0.44, 3.5, 17,  4,  1,  6, 10, 'Bantamweight'),
  ('Cory Sandhagen',       'striker',   0.67, 2.3, 17,  5,  9,  2,  6, 'Bantamweight'),
  ('Song Yadong',          'striker',   0.67, 2.3, 21,  7, 11,  3,  7, 'Bantamweight'),
  ('Umar Nurmagomedov',    'grappler',  0.88, 1.8, 17,  0,  4, 11,  2, 'Bantamweight'),
  ('Zhang Weili',          'all-around',0.70, 2.3, 24,  3, 13,  4,  7, 'Strawweight'),
  ('Rose Namajunas',       'all-around',0.60, 2.6, 13,  6,  7,  1,  5, 'Strawweight'),
  ('Tatiana Suarez',       'wrestler',  0.78, 1.9,  9,  0,  2,  5,  2, 'Strawweight'),
  ('Valentina Shevchenko', 'all-around',0.68, 2.5, 24,  4, 14,  2,  8, 'Flyweight'),
  ('Alexa Grasso',         'striker',   0.64, 2.3, 16,  4,  8,  2,  6, 'Flyweight')
ON CONFLICT (fighter_name) DO UPDATE
  SET style        = EXCLUDED.style,
      finish_rate  = EXCLUDED.finish_rate,
      avg_rounds   = EXCLUDED.avg_rounds,
      wins         = EXCLUDED.wins,
      losses       = EXCLUDED.losses,
      ko_wins      = EXCLUDED.ko_wins,
      sub_wins     = EXCLUDED.sub_wins,
      dec_wins     = EXCLUDED.dec_wins,
      weight_class = EXCLUDED.weight_class,
      last_updated = now();
