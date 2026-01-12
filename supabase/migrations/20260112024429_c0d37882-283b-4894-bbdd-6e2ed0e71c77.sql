-- Drop and recreate the check constraints to add SCORING_WING
ALTER TABLE player_archetypes DROP CONSTRAINT IF EXISTS player_archetypes_primary_archetype_check;
ALTER TABLE player_archetypes DROP CONSTRAINT IF EXISTS player_archetypes_secondary_archetype_check;

-- Add updated constraints with SCORING_WING
ALTER TABLE player_archetypes ADD CONSTRAINT player_archetypes_primary_archetype_check 
CHECK (primary_archetype = ANY (ARRAY['ELITE_REBOUNDER', 'GLASS_CLEANER', 'PURE_SHOOTER', 'PLAYMAKER', 
'COMBO_GUARD', 'TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER', 'SCORING_WING', 'SCORING_GUARD']));

ALTER TABLE player_archetypes ADD CONSTRAINT player_archetypes_secondary_archetype_check 
CHECK (secondary_archetype IS NULL OR secondary_archetype = ANY (ARRAY['ELITE_REBOUNDER', 'GLASS_CLEANER', 'PURE_SHOOTER', 'PLAYMAKER', 
'COMBO_GUARD', 'TWO_WAY_WING', 'STRETCH_BIG', 'RIM_PROTECTOR', 'ROLE_PLAYER', 'SCORING_WING', 'SCORING_GUARD']));

-- ============================================================================
-- EXPAND PLAYER ARCHETYPES: Add 120+ rotation players with new categories
-- ============================================================================

-- NEW ARCHETYPE: TWO_WAY_WING (versatile defenders)
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Aaron Gordon', 'TWO_WAY_WING', 5.5, 3.8, 14.5),
  ('OG Anunoby', 'TWO_WAY_WING', 4.8, 1.5, 16.2),
  ('Andrew Wiggins', 'TWO_WAY_WING', 4.5, 2.2, 13.5),
  ('Dillon Brooks', 'TWO_WAY_WING', 3.5, 2.0, 15.0),
  ('Herbert Jones', 'TWO_WAY_WING', 4.0, 2.5, 10.5),
  ('Jaden McDaniels', 'TWO_WAY_WING', 3.8, 1.5, 12.0),
  ('Derrick Jones Jr.', 'TWO_WAY_WING', 4.0, 1.2, 8.5),
  ('Caleb Martin', 'TWO_WAY_WING', 4.5, 2.0, 10.0),
  ('Dorian Finney-Smith', 'TWO_WAY_WING', 4.5, 1.8, 8.5),
  ('Isaac Okoro', 'TWO_WAY_WING', 3.0, 2.0, 9.5),
  ('Deni Avdija', 'TWO_WAY_WING', 6.0, 4.0, 14.0),
  ('Josh Hart', 'TWO_WAY_WING', 8.5, 4.2, 10.0),
  ('RJ Barrett', 'TWO_WAY_WING', 5.5, 3.0, 18.0),
  ('Franz Wagner', 'TWO_WAY_WING', 5.5, 5.5, 21.0),
  ('Brandon Ingram', 'TWO_WAY_WING', 5.2, 5.5, 23.0),
  ('Caris LeVert', 'TWO_WAY_WING', 4.0, 4.5, 15.5),
  ('Kelly Oubre Jr.', 'TWO_WAY_WING', 4.5, 1.2, 15.0),
  ('Norman Powell', 'TWO_WAY_WING', 3.0, 1.5, 18.0),
  ('Bruce Brown', 'TWO_WAY_WING', 4.5, 2.5, 9.0),
  ('Gary Harris', 'TWO_WAY_WING', 2.5, 2.0, 7.0),
  ('Luguentz Dort', 'TWO_WAY_WING', 4.0, 1.8, 12.5),
  ('Josh Richardson', 'TWO_WAY_WING', 3.5, 2.0, 10.0),
  ('Matisse Thybulle', 'TWO_WAY_WING', 2.0, 1.0, 5.0),
  ('Patrick Williams', 'TWO_WAY_WING', 4.0, 1.5, 10.0),
  ('Ziaire Williams', 'TWO_WAY_WING', 3.0, 2.0, 8.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- NEW ARCHETYPE: STRETCH_BIG (floor-spacing bigs)
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Lauri Markkanen', 'STRETCH_BIG', 8.5, 2.0, 24.0),
  ('Kristaps Porzingis', 'STRETCH_BIG', 7.0, 1.8, 20.0),
  ('Myles Turner', 'STRETCH_BIG', 6.5, 1.5, 16.0),
  ('John Collins', 'STRETCH_BIG', 7.5, 1.5, 17.0),
  ('Christian Wood', 'STRETCH_BIG', 7.0, 1.2, 15.0),
  ('Kelly Olynyk', 'STRETCH_BIG', 5.5, 3.0, 12.0),
  ('Marvin Bagley III', 'STRETCH_BIG', 6.0, 1.0, 10.0),
  ('Jalen Smith', 'STRETCH_BIG', 7.0, 1.0, 12.0),
  ('Obi Toppin', 'STRETCH_BIG', 5.0, 1.5, 14.0),
  ('Bobby Portis', 'STRETCH_BIG', 8.5, 1.5, 14.0),
  ('Mo Wagner', 'STRETCH_BIG', 5.5, 2.0, 11.0),
  ('Wendell Carter Jr.', 'STRETCH_BIG', 8.0, 2.5, 12.0),
  ('Harrison Barnes', 'STRETCH_BIG', 5.0, 1.8, 14.0),
  ('Jerami Grant', 'STRETCH_BIG', 4.5, 2.5, 21.0),
  ('Brook Lopez', 'STRETCH_BIG', 5.0, 1.5, 12.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- NEW ARCHETYPE: SCORING_WING (volume scorers)
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Khris Middleton', 'SCORING_WING', 4.5, 5.0, 18.0),
  ('Bojan Bogdanovic', 'SCORING_WING', 3.5, 2.0, 17.0),
  ('Marcus Morris', 'SCORING_WING', 4.5, 2.0, 12.0),
  ('Kyle Kuzma', 'SCORING_WING', 6.5, 2.5, 18.0),
  ('Tim Hardaway Jr.', 'SCORING_WING', 3.0, 2.0, 14.0),
  ('Terry Rozier', 'SCORING_WING', 4.0, 4.5, 18.0),
  ('Josh Giddey', 'SCORING_WING', 6.5, 6.0, 14.0),
  ('Miles Bridges', 'SCORING_WING', 6.0, 3.0, 18.0),
  ('Keldon Johnson', 'SCORING_WING', 5.0, 2.5, 16.0),
  ('Kevin Huerter', 'SCORING_WING', 3.0, 2.5, 12.0),
  ('Coby White', 'SCORING_WING', 3.5, 5.0, 18.0),
  ('Malik Monk', 'SCORING_WING', 2.8, 4.5, 15.0),
  ('Naji Marshall', 'SCORING_WING', 4.0, 3.5, 12.0),
  ('Cam Thomas', 'SCORING_WING', 3.0, 3.5, 24.0),
  ('Anfernee Simons', 'SCORING_WING', 2.5, 4.0, 20.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More ELITE_REBOUNDERS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Clint Capela', 'ELITE_REBOUNDER', 11.5, 1.2, 11.0),
  ('Walker Kessler', 'ELITE_REBOUNDER', 9.5, 0.8, 8.5),
  ('Moritz Wagner', 'ELITE_REBOUNDER', 6.5, 2.0, 12.0),
  ('Chet Holmgren', 'ELITE_REBOUNDER', 8.5, 2.5, 17.0),
  ('Jericho Sims', 'ELITE_REBOUNDER', 7.0, 0.5, 5.0),
  ('Isaiah Hartenstein', 'ELITE_REBOUNDER', 9.0, 3.5, 8.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More GLASS_CLEANERS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Daniel Gafford', 'GLASS_CLEANER', 7.5, 1.0, 10.5),
  ('Drew Eubanks', 'GLASS_CLEANER', 6.5, 1.0, 7.0),
  ('Jaxson Hayes', 'GLASS_CLEANER', 5.5, 0.8, 8.0),
  ('Onyeka Okongwu', 'GLASS_CLEANER', 7.5, 1.5, 10.0),
  ('Precious Achiuwa', 'GLASS_CLEANER', 7.0, 1.5, 8.5)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More PLAYMAKERS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Immanuel Quickley', 'PLAYMAKER', 4.0, 7.0, 14.0),
  ('Tre Jones', 'PLAYMAKER', 3.5, 8.0, 12.0),
  ('Jose Alvarado', 'PLAYMAKER', 2.5, 4.5, 9.0),
  ('Ayo Dosunmu', 'PLAYMAKER', 3.5, 5.5, 10.0),
  ('Dennis Schroder', 'PLAYMAKER', 2.5, 6.5, 14.0),
  ('Monte Morris', 'PLAYMAKER', 2.0, 4.5, 8.0),
  ('Cade Cunningham', 'PLAYMAKER', 6.0, 9.0, 24.0),
  ('Fred VanVleet', 'PLAYMAKER', 4.0, 6.5, 16.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More PURE_SHOOTERS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Buddy Hield', 'PURE_SHOOTER', 3.5, 2.5, 14.0),
  ('Malik Beasley', 'PURE_SHOOTER', 3.0, 1.5, 12.0),
  ('Luke Kennard', 'PURE_SHOOTER', 2.5, 2.0, 8.0),
  ('Seth Curry', 'PURE_SHOOTER', 2.0, 2.0, 8.0),
  ('Grayson Allen', 'PURE_SHOOTER', 3.0, 2.5, 12.0),
  ('Sam Hauser', 'PURE_SHOOTER', 2.5, 1.0, 9.0),
  ('Quentin Grimes', 'PURE_SHOOTER', 3.0, 2.0, 10.0),
  ('Max Strus', 'PURE_SHOOTER', 3.5, 2.0, 12.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More COMBO_GUARDS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Jalen Williams', 'COMBO_GUARD', 5.0, 5.5, 20.0),
  ('Austin Reaves', 'COMBO_GUARD', 4.0, 5.0, 16.0),
  ('Jordan Poole', 'COMBO_GUARD', 2.5, 4.5, 17.0),
  ('Marcus Smart', 'COMBO_GUARD', 3.5, 5.5, 12.0),
  ('Tyus Jones', 'COMBO_GUARD', 2.0, 6.0, 12.0),
  ('Spencer Dinwiddie', 'COMBO_GUARD', 3.0, 5.0, 14.0),
  ('Dejounte Murray', 'COMBO_GUARD', 5.0, 6.5, 20.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- More RIM_PROTECTORS
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Jaren Jackson Jr.', 'RIM_PROTECTOR', 5.5, 1.5, 22.0),
  ('Evan Mobley', 'RIM_PROTECTOR', 9.0, 3.5, 16.0),
  ('Robert Williams III', 'RIM_PROTECTOR', 8.0, 2.0, 10.0),
  ('Daniel Theis', 'RIM_PROTECTOR', 5.0, 1.5, 8.0),
  ('Jalen Duren', 'RIM_PROTECTOR', 10.0, 1.5, 11.0),
  ('Mark Williams', 'RIM_PROTECTOR', 9.0, 1.0, 10.0),
  ('Aleksej Pokusevski', 'RIM_PROTECTOR', 5.0, 2.5, 8.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- ROLE_PLAYERS: Backup/rotation players (BLOCKED from parlays)
INSERT INTO player_archetypes (player_name, primary_archetype, avg_rebounds, avg_assists, avg_points)
VALUES
  ('Javonte Green', 'ROLE_PLAYER', 2.5, 1.0, 5.0),
  ('Haywood Highsmith', 'ROLE_PLAYER', 2.0, 1.0, 5.0),
  ('Cedi Osman', 'ROLE_PLAYER', 2.5, 1.5, 6.0),
  ('Justise Winslow', 'ROLE_PLAYER', 3.0, 2.0, 5.0),
  ('T.J. McConnell', 'ROLE_PLAYER', 2.0, 5.0, 6.0),
  ('Patrick Beverley', 'ROLE_PLAYER', 3.0, 3.0, 5.0),
  ('Taurean Prince', 'ROLE_PLAYER', 3.0, 1.5, 8.0),
  ('Jae Crowder', 'ROLE_PLAYER', 3.5, 1.5, 7.0),
  ('Thaddeus Young', 'ROLE_PLAYER', 4.0, 2.0, 5.0),
  ('P.J. Tucker', 'ROLE_PLAYER', 3.0, 1.0, 3.0),
  ('Royce ONeale', 'ROLE_PLAYER', 3.0, 2.0, 5.0),
  ('Joe Ingles', 'ROLE_PLAYER', 2.0, 3.0, 5.0),
  ('Danilo Gallinari', 'ROLE_PLAYER', 3.0, 1.5, 8.0),
  ('Chris Duarte', 'ROLE_PLAYER', 2.5, 2.0, 7.0),
  ('Jalen Hood-Schifino', 'ROLE_PLAYER', 2.0, 2.5, 6.0)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points;

-- Add tracking columns to sharp_ai_parlays
ALTER TABLE sharp_ai_parlays 
ADD COLUMN IF NOT EXISTS team_diversity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS archetype_diversity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_dream_team BOOLEAN DEFAULT FALSE;

-- Add tracking columns to heat_parlays
ALTER TABLE heat_parlays 
ADD COLUMN IF NOT EXISTS team_diversity INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS archetype_diversity INTEGER DEFAULT 0;