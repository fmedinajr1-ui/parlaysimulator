CREATE UNIQUE INDEX IF NOT EXISTS category_sweet_spots_player_prop_date_key
  ON category_sweet_spots (player_name, prop_type, analysis_date);

ALTER TABLE category_sweet_spots
  ADD COLUMN IF NOT EXISTS fade_only boolean DEFAULT false;