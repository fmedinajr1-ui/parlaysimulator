ALTER TABLE mispriced_lines ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'pending';
ALTER TABLE mispriced_lines ADD COLUMN IF NOT EXISTS actual_value numeric;
ALTER TABLE mispriced_lines ADD COLUMN IF NOT EXISTS settled_at timestamptz;