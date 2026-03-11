DROP INDEX IF EXISTS idx_category_sweet_spots_unique;
CREATE UNIQUE INDEX idx_category_sweet_spots_unique ON category_sweet_spots (player_name, prop_type, analysis_date, category);