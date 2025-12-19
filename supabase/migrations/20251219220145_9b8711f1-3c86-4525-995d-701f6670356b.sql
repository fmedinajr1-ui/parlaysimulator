-- Seed team_season_standings with current NBA standings (2024-25 season)
INSERT INTO team_season_standings (sport, team_name, wins, losses, ties, win_pct, home_record, away_record, last_10, streak, conference, division, conference_rank, division_rank, points_for, points_against, point_differential, season)
VALUES
  -- Eastern Conference
  ('NBA', 'Cleveland Cavaliers', 25, 4, 0, 0.862, '14-0', '11-4', '9-1', 'W7', 'Eastern', 'Central', 1, 1, 120.5, 108.2, 12.3, '2024-25'),
  ('NBA', 'Boston Celtics', 21, 8, 0, 0.724, '11-3', '10-5', '6-4', 'L1', 'Eastern', 'Atlantic', 2, 1, 118.8, 110.5, 8.3, '2024-25'),
  ('NBA', 'New York Knicks', 18, 10, 0, 0.643, '9-5', '9-5', '6-4', 'W2', 'Eastern', 'Atlantic', 3, 2, 115.2, 110.8, 4.4, '2024-25'),
  ('NBA', 'Orlando Magic', 18, 12, 0, 0.600, '11-4', '7-8', '5-5', 'L3', 'Eastern', 'Southeast', 4, 1, 108.5, 104.2, 4.3, '2024-25'),
  ('NBA', 'Milwaukee Bucks', 16, 12, 0, 0.571, '10-5', '6-7', '6-4', 'W3', 'Eastern', 'Central', 5, 2, 113.8, 111.5, 2.3, '2024-25'),
  ('NBA', 'Atlanta Hawks', 16, 14, 0, 0.533, '9-5', '7-9', '5-5', 'L1', 'Eastern', 'Southeast', 6, 2, 118.2, 117.5, 0.7, '2024-25'),
  ('NBA', 'Miami Heat', 15, 13, 0, 0.536, '9-4', '6-9', '7-3', 'W4', 'Eastern', 'Southeast', 7, 3, 110.5, 109.2, 1.3, '2024-25'),
  ('NBA', 'Indiana Pacers', 15, 15, 0, 0.500, '9-6', '6-9', '5-5', 'L2', 'Eastern', 'Central', 8, 3, 117.8, 118.2, -0.4, '2024-25'),
  ('NBA', 'Chicago Bulls', 14, 16, 0, 0.467, '9-7', '5-9', '4-6', 'L1', 'Eastern', 'Central', 9, 4, 112.5, 114.8, -2.3, '2024-25'),
  ('NBA', 'Detroit Pistons', 13, 16, 0, 0.448, '9-6', '4-10', '6-4', 'W2', 'Eastern', 'Central', 10, 5, 109.8, 112.5, -2.7, '2024-25'),
  ('NBA', 'Brooklyn Nets', 12, 16, 0, 0.429, '6-8', '6-8', '3-7', 'L3', 'Eastern', 'Atlantic', 11, 3, 106.2, 110.5, -4.3, '2024-25'),
  ('NBA', 'Philadelphia 76ers', 11, 17, 0, 0.393, '6-8', '5-9', '4-6', 'W1', 'Eastern', 'Atlantic', 12, 4, 107.5, 111.2, -3.7, '2024-25'),
  ('NBA', 'Toronto Raptors', 8, 21, 0, 0.276, '4-10', '4-11', '2-8', 'L4', 'Eastern', 'Atlantic', 13, 5, 105.2, 115.8, -10.6, '2024-25'),
  ('NBA', 'Charlotte Hornets', 7, 21, 0, 0.250, '4-10', '3-11', '3-7', 'W1', 'Eastern', 'Southeast', 14, 4, 104.8, 116.2, -11.4, '2024-25'),
  ('NBA', 'Washington Wizards', 5, 22, 0, 0.185, '3-9', '2-13', '2-8', 'L5', 'Eastern', 'Southeast', 15, 5, 103.5, 118.5, -15.0, '2024-25'),
  -- Western Conference
  ('NBA', 'Oklahoma City Thunder', 22, 5, 0, 0.815, '11-2', '11-3', '8-2', 'W5', 'Western', 'Northwest', 1, 1, 119.2, 105.8, 13.4, '2024-25'),
  ('NBA', 'Memphis Grizzlies', 20, 10, 0, 0.667, '9-4', '11-6', '7-3', 'W2', 'Western', 'Southwest', 2, 1, 121.5, 112.2, 9.3, '2024-25'),
  ('NBA', 'Houston Rockets', 19, 10, 0, 0.655, '12-3', '7-7', '8-2', 'W6', 'Western', 'Southwest', 3, 2, 112.8, 106.5, 6.3, '2024-25'),
  ('NBA', 'Dallas Mavericks', 18, 11, 0, 0.621, '10-4', '8-7', '6-4', 'L1', 'Western', 'Southwest', 4, 3, 116.2, 111.5, 4.7, '2024-25'),
  ('NBA', 'Denver Nuggets', 17, 11, 0, 0.607, '8-5', '9-6', '5-5', 'W1', 'Western', 'Northwest', 5, 2, 115.5, 111.8, 3.7, '2024-25'),
  ('NBA', 'Los Angeles Clippers', 17, 12, 0, 0.586, '10-4', '7-8', '6-4', 'W3', 'Western', 'Pacific', 6, 1, 109.8, 106.2, 3.6, '2024-25'),
  ('NBA', 'Los Angeles Lakers', 16, 12, 0, 0.571, '10-4', '6-8', '5-5', 'L2', 'Western', 'Pacific', 7, 2, 112.5, 109.8, 2.7, '2024-25'),
  ('NBA', 'Minnesota Timberwolves', 16, 12, 0, 0.571, '8-6', '8-6', '4-6', 'L1', 'Western', 'Northwest', 8, 3, 108.2, 106.5, 1.7, '2024-25'),
  ('NBA', 'Sacramento Kings', 14, 16, 0, 0.467, '8-6', '6-10', '4-6', 'W1', 'Western', 'Pacific', 9, 3, 113.5, 115.2, -1.7, '2024-25'),
  ('NBA', 'San Antonio Spurs', 14, 16, 0, 0.467, '7-9', '7-7', '5-5', 'W2', 'Western', 'Southwest', 10, 4, 110.2, 112.8, -2.6, '2024-25'),
  ('NBA', 'Phoenix Suns', 13, 15, 0, 0.464, '6-9', '7-6', '3-7', 'L4', 'Western', 'Pacific', 11, 4, 111.8, 113.5, -1.7, '2024-25'),
  ('NBA', 'Golden State Warriors', 13, 14, 0, 0.481, '8-6', '5-8', '4-6', 'L2', 'Western', 'Pacific', 12, 5, 112.2, 113.8, -1.6, '2024-25'),
  ('NBA', 'Portland Trail Blazers', 10, 18, 0, 0.357, '6-7', '4-11', '3-7', 'L3', 'Western', 'Northwest', 13, 4, 105.5, 112.8, -7.3, '2024-25'),
  ('NBA', 'Utah Jazz', 8, 19, 0, 0.296, '5-8', '3-11', '2-8', 'L6', 'Western', 'Northwest', 14, 5, 104.2, 114.5, -10.3, '2024-25'),
  ('NBA', 'New Orleans Pelicans', 5, 25, 0, 0.167, '3-12', '2-13', '1-9', 'L8', 'Western', 'Southwest', 15, 5, 102.5, 117.2, -14.7, '2024-25')
ON CONFLICT (id) DO NOTHING;

-- Seed team_season_standings with current NFL standings (2024 season)
INSERT INTO team_season_standings (sport, team_name, wins, losses, ties, win_pct, home_record, away_record, last_10, streak, conference, division, conference_rank, division_rank, points_for, points_against, point_differential, season)
VALUES
  -- AFC
  ('NFL', 'Kansas City Chiefs', 14, 1, 0, 0.933, '7-0', '7-1', '9-1', 'W5', 'AFC', 'West', 1, 1, 385, 278, 107, '2024'),
  ('NFL', 'Buffalo Bills', 12, 3, 0, 0.800, '7-0', '5-3', '8-2', 'W3', 'AFC', 'East', 2, 1, 451, 316, 135, '2024'),
  ('NFL', 'Pittsburgh Steelers', 10, 5, 0, 0.667, '5-3', '5-2', '6-4', 'L2', 'AFC', 'North', 3, 1, 322, 280, 42, '2024'),
  ('NFL', 'Baltimore Ravens', 10, 5, 0, 0.667, '6-2', '4-3', '7-3', 'W1', 'AFC', 'North', 4, 2, 425, 320, 105, '2024'),
  ('NFL', 'Houston Texans', 9, 6, 0, 0.600, '4-3', '5-3', '5-5', 'L1', 'AFC', 'South', 5, 1, 345, 298, 47, '2024'),
  ('NFL', 'Los Angeles Chargers', 9, 6, 0, 0.600, '5-2', '4-4', '6-4', 'W2', 'AFC', 'West', 6, 2, 342, 268, 74, '2024'),
  ('NFL', 'Denver Broncos', 9, 6, 0, 0.600, '5-3', '4-3', '6-4', 'W3', 'AFC', 'West', 7, 3, 328, 285, 43, '2024'),
  ('NFL', 'Indianapolis Colts', 7, 8, 0, 0.467, '4-4', '3-4', '4-6', 'L2', 'AFC', 'South', 8, 2, 310, 342, -32, '2024'),
  ('NFL', 'Miami Dolphins', 7, 8, 0, 0.467, '3-5', '4-3', '4-6', 'L1', 'AFC', 'East', 9, 2, 295, 318, -23, '2024'),
  ('NFL', 'Cincinnati Bengals', 7, 8, 0, 0.467, '4-4', '3-4', '5-5', 'W1', 'AFC', 'North', 10, 3, 378, 365, 13, '2024'),
  ('NFL', 'New York Jets', 4, 11, 0, 0.267, '3-5', '1-6', '2-8', 'L4', 'AFC', 'East', 13, 3, 265, 355, -90, '2024'),
  ('NFL', 'New England Patriots', 3, 12, 0, 0.200, '2-5', '1-7', '2-8', 'L3', 'AFC', 'East', 14, 4, 228, 368, -140, '2024'),
  ('NFL', 'Jacksonville Jaguars', 3, 12, 0, 0.200, '2-5', '1-7', '1-9', 'L5', 'AFC', 'South', 15, 3, 260, 398, -138, '2024'),
  ('NFL', 'Tennessee Titans', 3, 12, 0, 0.200, '2-6', '1-6', '2-8', 'L3', 'AFC', 'South', 16, 4, 248, 380, -132, '2024'),
  ('NFL', 'Cleveland Browns', 3, 12, 0, 0.200, '2-5', '1-7', '1-9', 'L6', 'AFC', 'North', 11, 4, 235, 375, -140, '2024'),
  ('NFL', 'Las Vegas Raiders', 3, 12, 0, 0.200, '2-6', '1-6', '1-9', 'L8', 'AFC', 'West', 12, 4, 255, 378, -123, '2024'),
  -- NFC
  ('NFL', 'Detroit Lions', 13, 2, 0, 0.867, '7-0', '6-2', '9-1', 'W8', 'NFC', 'North', 1, 1, 498, 318, 180, '2024'),
  ('NFL', 'Philadelphia Eagles', 12, 3, 0, 0.800, '6-1', '6-2', '8-2', 'W4', 'NFC', 'East', 2, 1, 385, 268, 117, '2024'),
  ('NFL', 'Minnesota Vikings', 13, 2, 0, 0.867, '7-0', '6-2', '9-1', 'W5', 'NFC', 'North', 3, 2, 432, 298, 134, '2024'),
  ('NFL', 'Green Bay Packers', 10, 5, 0, 0.667, '6-2', '4-3', '7-3', 'W2', 'NFC', 'North', 4, 3, 378, 318, 60, '2024'),
  ('NFL', 'Los Angeles Rams', 9, 6, 0, 0.600, '5-3', '4-3', '6-4', 'W1', 'NFC', 'West', 5, 1, 365, 332, 33, '2024'),
  ('NFL', 'Tampa Bay Buccaneers', 9, 6, 0, 0.600, '5-2', '4-4', '6-4', 'W3', 'NFC', 'South', 6, 1, 378, 315, 63, '2024'),
  ('NFL', 'Washington Commanders', 9, 6, 0, 0.600, '4-3', '5-3', '5-5', 'L2', 'NFC', 'East', 7, 2, 365, 332, 33, '2024'),
  ('NFL', 'Seattle Seahawks', 9, 6, 0, 0.600, '5-3', '4-3', '5-5', 'W1', 'NFC', 'West', 8, 2, 348, 328, 20, '2024'),
  ('NFL', 'Arizona Cardinals', 7, 8, 0, 0.467, '4-3', '3-5', '4-6', 'L3', 'NFC', 'West', 9, 3, 322, 352, -30, '2024'),
  ('NFL', 'Atlanta Falcons', 7, 8, 0, 0.467, '3-4', '4-4', '3-7', 'L4', 'NFC', 'South', 10, 2, 335, 358, -23, '2024'),
  ('NFL', 'San Francisco 49ers', 6, 9, 0, 0.400, '4-4', '2-5', '3-7', 'L2', 'NFC', 'West', 11, 4, 305, 335, -30, '2024'),
  ('NFL', 'Dallas Cowboys', 6, 9, 0, 0.400, '4-4', '2-5', '3-7', 'L3', 'NFC', 'East', 12, 3, 285, 342, -57, '2024'),
  ('NFL', 'New Orleans Saints', 5, 10, 0, 0.333, '3-5', '2-5', '2-8', 'L5', 'NFC', 'South', 13, 3, 298, 378, -80, '2024'),
  ('NFL', 'Chicago Bears', 4, 11, 0, 0.267, '2-5', '2-6', '2-8', 'L7', 'NFC', 'North', 14, 4, 268, 395, -127, '2024'),
  ('NFL', 'Carolina Panthers', 4, 11, 0, 0.267, '3-5', '1-6', '3-7', 'W1', 'NFC', 'South', 15, 4, 258, 388, -130, '2024'),
  ('NFL', 'New York Giants', 3, 12, 0, 0.200, '2-6', '1-6', '1-9', 'L6', 'NFC', 'East', 16, 4, 235, 395, -160, '2024')
ON CONFLICT (id) DO NOTHING;