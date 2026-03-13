
CREATE TABLE game_market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  sport text NOT NULL,
  bet_type text NOT NULL,
  home_team text,
  away_team text,
  fanduel_line numeric,
  fanduel_home_odds integer,
  fanduel_away_odds integer,
  fanduel_over_odds integer,
  fanduel_under_odds integer,
  commence_time timestamptz,
  scan_time timestamptz DEFAULT now(),
  analysis_date date NOT NULL,
  drift_amount numeric DEFAULT 0,
  drift_direction text,
  alert_sent boolean DEFAULT false
);
CREATE INDEX idx_gms_date_game ON game_market_snapshots(analysis_date, game_id);
CREATE INDEX idx_gms_commence ON game_market_snapshots(commence_time);
CREATE INDEX idx_gms_sport_date ON game_market_snapshots(sport, analysis_date);
