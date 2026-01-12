-- Populate player_archetypes with 65+ manually classified NBA players
-- ELITE_REBOUNDER (19 players) - avg >= 9 rebounds
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_rebounds, avg_points, avg_assists, manual_override)
VALUES 
  ('Domantas Sabonis', 'ELITE_REBOUNDER', 'PLAYMAKER', 0.98, 14.3, 17.8, 8.3, true),
  ('Nikola Jokic', 'ELITE_REBOUNDER', 'PLAYMAKER', 0.99, 12.1, 26.1, 9.3, true),
  ('Giannis Antetokounmpo', 'ELITE_REBOUNDER', 'PURE_SHOOTER', 0.97, 10.8, 28.2, 5.2, true),
  ('Rudy Gobert', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.99, 10.5, 12.6, 1.6, true),
  ('Anthony Davis', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.96, 10.1, 18.6, 2.4, true),
  ('Joel Embiid', 'ELITE_REBOUNDER', 'PURE_SHOOTER', 0.95, 10.0, 23.6, 3.8, true),
  ('Karl-Anthony Towns', 'ELITE_REBOUNDER', 'STRETCH_BIG', 0.94, 9.8, 15.5, 2.2, true),
  ('Bam Adebayo', 'ELITE_REBOUNDER', 'PLAYMAKER', 0.93, 9.3, 14.3, 2.6, true),
  ('Andre Drummond', 'ELITE_REBOUNDER', NULL, 0.90, 9.0, 8.0, 1.0, true),
  ('Victor Wembanyama', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.92, 10.5, 22.7, 3.1, true),
  ('Jarrett Allen', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.91, 9.5, 14.2, 1.8, true),
  ('Jonas Valanciunas', 'ELITE_REBOUNDER', NULL, 0.89, 9.2, 12.8, 2.0, true),
  ('DeAndre Ayton', 'ELITE_REBOUNDER', NULL, 0.88, 9.0, 16.5, 1.9, true),
  ('Steven Adams', 'ELITE_REBOUNDER', NULL, 0.87, 9.1, 8.5, 1.2, true),
  ('Alperen Sengun', 'ELITE_REBOUNDER', 'PLAYMAKER', 0.90, 9.3, 18.5, 5.0, true),
  ('Evan Mobley', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.88, 9.0, 15.2, 2.8, true),
  ('Paolo Banchero', 'ELITE_REBOUNDER', 'PURE_SHOOTER', 0.86, 8.8, 23.5, 5.2, true),
  ('Chet Holmgren', 'ELITE_REBOUNDER', 'RIM_PROTECTOR', 0.87, 8.5, 16.8, 2.5, true),
  ('Jabari Smith Jr', 'ELITE_REBOUNDER', 'STRETCH_BIG', 0.85, 8.2, 12.5, 1.8, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_points = EXCLUDED.avg_points,
  avg_assists = EXCLUDED.avg_assists,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();

-- GLASS_CLEANER (18 players) - avg 6-9 rebounds
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_rebounds, avg_points, avg_assists, manual_override)
VALUES 
  ('Jayson Tatum', 'GLASS_CLEANER', 'PURE_SHOOTER', 0.92, 8.1, 27.1, 4.9, true),
  ('Julius Randle', 'GLASS_CLEANER', 'PLAYMAKER', 0.90, 8.3, 21.5, 5.0, true),
  ('LeBron James', 'GLASS_CLEANER', 'PLAYMAKER', 0.95, 7.3, 23.5, 8.2, true),
  ('Pascal Siakam', 'GLASS_CLEANER', 'TWO_WAY_WING', 0.89, 7.8, 19.5, 5.5, true),
  ('Lauri Markkanen', 'GLASS_CLEANER', 'STRETCH_BIG', 0.88, 7.5, 22.3, 2.1, true),
  ('Mitchell Robinson', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.87, 7.2, 8.5, 0.8, true),
  ('Donovan Clingan', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.85, 6.8, 6.2, 0.5, true),
  ('Ivica Zubac', 'GLASS_CLEANER', NULL, 0.86, 7.0, 11.5, 1.5, true),
  ('Nic Claxton', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.85, 6.5, 9.8, 1.2, true),
  ('Mason Plumlee', 'GLASS_CLEANER', NULL, 0.82, 6.3, 6.5, 2.5, true),
  ('Robert Williams', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.84, 6.8, 7.2, 1.5, true),
  ('Kristaps Porzingis', 'GLASS_CLEANER', 'STRETCH_BIG', 0.88, 6.5, 18.5, 1.8, true),
  ('Zach Edey', 'GLASS_CLEANER', NULL, 0.83, 7.5, 10.2, 0.8, true),
  ('Isaiah Hartenstein', 'GLASS_CLEANER', 'PLAYMAKER', 0.86, 7.8, 9.5, 3.5, true),
  ('Daniel Gafford', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.84, 6.2, 10.8, 0.9, true),
  ('Clint Capela', 'GLASS_CLEANER', NULL, 0.85, 7.0, 9.5, 1.0, true),
  ('Brook Lopez', 'GLASS_CLEANER', 'RIM_PROTECTOR', 0.83, 6.0, 12.5, 1.2, true),
  ('Santi Aldama', 'GLASS_CLEANER', 'STRETCH_BIG', 0.82, 6.5, 11.5, 2.0, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_points = EXCLUDED.avg_points,
  avg_assists = EXCLUDED.avg_assists,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();

-- PURE_SHOOTER (18 players) - 22+ ppg or 3+ 3PM
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_points, avg_rebounds, avg_assists, manual_override)
VALUES 
  ('Stephen Curry', 'PURE_SHOOTER', NULL, 0.99, 29.2, 3.9, 5.3, true),
  ('Jaylen Brown', 'PURE_SHOOTER', 'TWO_WAY_WING', 0.95, 30.2, 6.5, 5.4, true),
  ('Kawhi Leonard', 'PURE_SHOOTER', 'TWO_WAY_WING', 0.94, 28.7, 6.6, 3.7, true),
  ('Kevin Durant', 'PURE_SHOOTER', NULL, 0.96, 27.8, 6.2, 5.5, true),
  ('Kyrie Irving', 'PURE_SHOOTER', 'COMBO_GUARD', 0.95, 27.8, 4.7, 5.7, true),
  ('Damian Lillard', 'PURE_SHOOTER', 'PLAYMAKER', 0.97, 25.2, 4.9, 6.7, true),
  ('Devin Booker', 'PURE_SHOOTER', 'COMBO_GUARD', 0.95, 22.0, 4.2, 5.7, true),
  ('Donovan Mitchell', 'PURE_SHOOTER', 'COMBO_GUARD', 0.94, 22.3, 4.4, 6.2, true),
  ('Zach LaVine', 'PURE_SHOOTER', NULL, 0.92, 24.8, 4.5, 4.2, true),
  ('Bradley Beal', 'PURE_SHOOTER', NULL, 0.91, 21.5, 4.2, 4.8, true),
  ('CJ McCollum', 'PURE_SHOOTER', NULL, 0.90, 21.2, 3.8, 5.5, true),
  ('Klay Thompson', 'PURE_SHOOTER', NULL, 0.93, 17.8, 3.2, 2.2, true),
  ('Buddy Hield', 'PURE_SHOOTER', NULL, 0.91, 15.5, 3.5, 2.8, true),
  ('Desmond Bane', 'PURE_SHOOTER', 'TWO_WAY_WING', 0.89, 22.5, 4.8, 5.0, true),
  ('Cam Thomas', 'PURE_SHOOTER', NULL, 0.88, 24.5, 3.2, 4.2, true),
  ('Austin Reaves', 'PURE_SHOOTER', 'COMBO_GUARD', 0.86, 18.5, 4.0, 5.2, true),
  ('Keegan Murray', 'PURE_SHOOTER', 'TWO_WAY_WING', 0.85, 16.8, 5.2, 2.5, true),
  ('Jalen Williams', 'PURE_SHOOTER', 'TWO_WAY_WING', 0.87, 19.2, 5.5, 5.0, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_points = EXCLUDED.avg_points,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();

-- PLAYMAKER (15 players) - avg >= 7 assists
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_assists, avg_points, avg_rebounds, manual_override)
VALUES 
  ('Tyrese Haliburton', 'PLAYMAKER', NULL, 0.99, 10.9, 20.3, 4.3, true),
  ('James Harden', 'PLAYMAKER', 'PURE_SHOOTER', 0.96, 8.5, 20.9, 4.7, true),
  ('Trae Young', 'PLAYMAKER', 'PURE_SHOOTER', 0.98, 8.4, 20.5, 3.3, true),
  ('Ja Morant', 'PLAYMAKER', 'COMBO_GUARD', 0.94, 7.5, 25.4, 4.7, true),
  ('Chris Paul', 'PLAYMAKER', NULL, 0.99, 8.0, 10.0, 3.5, true),
  ('Dejounte Murray', 'PLAYMAKER', 'TWO_WAY_WING', 0.91, 7.2, 18.5, 5.5, true),
  ('Fred VanVleet', 'PLAYMAKER', 'PURE_SHOOTER', 0.90, 7.0, 16.8, 3.5, true),
  ('Darius Garland', 'PLAYMAKER', 'PURE_SHOOTER', 0.92, 7.5, 21.0, 2.8, true),
  ('LaMelo Ball', 'PLAYMAKER', 'PURE_SHOOTER', 0.93, 7.8, 22.5, 5.2, true),
  ('Cade Cunningham', 'PLAYMAKER', 'COMBO_GUARD', 0.91, 7.2, 22.8, 6.2, true),
  ('Tyus Jones', 'PLAYMAKER', NULL, 0.88, 7.5, 12.5, 2.8, true),
  ('Luka Doncic', 'PLAYMAKER', 'PURE_SHOOTER', 0.97, 8.8, 28.5, 8.2, true),
  ('Jalen Brunson', 'PLAYMAKER', 'PURE_SHOOTER', 0.93, 7.2, 26.3, 4.1, true),
  ('De Aaron Fox', 'PLAYMAKER', 'COMBO_GUARD', 0.92, 7.0, 26.8, 4.5, true),
  ('Shai Gilgeous-Alexander', 'PLAYMAKER', 'PURE_SHOOTER', 0.95, 6.5, 31.5, 5.2, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_assists = EXCLUDED.avg_assists,
  avg_points = EXCLUDED.avg_points,
  avg_rebounds = EXCLUDED.avg_rebounds,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();

-- SCORING_GUARD / COMBO_GUARD (12 players)
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_points, avg_rebounds, avg_assists, manual_override)
VALUES 
  ('Anthony Edwards', 'COMBO_GUARD', 'PURE_SHOOTER', 0.94, 27.2, 5.5, 5.2, true),
  ('Tyrese Maxey', 'COMBO_GUARD', 'PURE_SHOOTER', 0.92, 25.8, 3.8, 6.2, true),
  ('Jamal Murray', 'COMBO_GUARD', 'PLAYMAKER', 0.90, 21.5, 4.2, 6.5, true),
  ('DeMar DeRozan', 'COMBO_GUARD', 'PLAYMAKER', 0.91, 24.5, 4.5, 5.8, true),
  ('Anfernee Simons', 'COMBO_GUARD', 'PURE_SHOOTER', 0.88, 22.8, 3.2, 4.5, true),
  ('Jrue Holiday', 'COMBO_GUARD', 'TWO_WAY_WING', 0.89, 13.2, 4.8, 5.2, true),
  ('Mikal Bridges', 'COMBO_GUARD', 'TWO_WAY_WING', 0.87, 18.5, 4.2, 3.5, true),
  ('Coby White', 'COMBO_GUARD', 'PURE_SHOOTER', 0.85, 18.2, 3.8, 5.0, true),
  ('Scoot Henderson', 'COMBO_GUARD', 'PLAYMAKER', 0.82, 14.5, 3.2, 5.5, true),
  ('Jordan Poole', 'COMBO_GUARD', 'PURE_SHOOTER', 0.84, 17.8, 2.8, 4.5, true),
  ('Immanuel Quickley', 'COMBO_GUARD', 'PLAYMAKER', 0.83, 16.5, 4.2, 6.8, true),
  ('Scottie Barnes', 'COMBO_GUARD', 'GLASS_CLEANER', 0.88, 19.5, 7.8, 6.2, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_points = EXCLUDED.avg_points,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_assists = EXCLUDED.avg_assists,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();

-- RIM_PROTECTOR (5 players) - avg >= 1.5 blocks
INSERT INTO player_archetypes (player_name, primary_archetype, secondary_archetype, archetype_confidence, avg_rebounds, avg_points, avg_assists, manual_override)
VALUES 
  ('Jaren Jackson Jr', 'RIM_PROTECTOR', 'STRETCH_BIG', 0.94, 5.5, 22.5, 2.2, true),
  ('Myles Turner', 'RIM_PROTECTOR', 'STRETCH_BIG', 0.92, 6.2, 16.8, 1.5, true),
  ('Walker Kessler', 'RIM_PROTECTOR', 'GLASS_CLEANER', 0.90, 7.5, 8.5, 0.8, true),
  ('Dereck Lively II', 'RIM_PROTECTOR', 'GLASS_CLEANER', 0.88, 6.8, 8.2, 1.2, true),
  ('Mark Williams', 'RIM_PROTECTOR', 'GLASS_CLEANER', 0.87, 7.2, 9.8, 1.0, true)
ON CONFLICT (player_name) DO UPDATE SET 
  primary_archetype = EXCLUDED.primary_archetype,
  secondary_archetype = EXCLUDED.secondary_archetype,
  archetype_confidence = EXCLUDED.archetype_confidence,
  avg_rebounds = EXCLUDED.avg_rebounds,
  avg_points = EXCLUDED.avg_points,
  avg_assists = EXCLUDED.avg_assists,
  manual_override = EXCLUDED.manual_override,
  last_updated = NOW();