-- Add CLV and determination tracking to line_movements
ALTER TABLE line_movements 
ADD COLUMN determination_status text DEFAULT 'pending' CHECK (determination_status IN ('pending', 'final')),
ADD COLUMN opening_price numeric,
ADD COLUMN opening_point numeric,
ADD COLUMN closing_price numeric,
ADD COLUMN closing_point numeric,
ADD COLUMN final_determination_time timestamp with time zone,
ADD COLUMN clv_direction text CHECK (clv_direction IN ('positive', 'negative', 'neutral', NULL)),
ADD COLUMN preliminary_confidence numeric;

-- Add indexes for performance on time-based queries
CREATE INDEX idx_line_movements_commence_time ON line_movements(commence_time) WHERE determination_status = 'pending';
CREATE INDEX idx_line_movements_determination_status ON line_movements(determination_status);

-- Add pick status tracking to suggested_parlays
ALTER TABLE suggested_parlays
ADD COLUMN pick_status text DEFAULT 'pending' CHECK (pick_status IN ('pending', 'locked', 'final')),
ADD COLUMN initial_recommendation text,
ADD COLUMN final_recommendation text,
ADD COLUMN clv_score numeric;

-- Add index for pending picks
CREATE INDEX idx_suggested_parlays_pick_status ON suggested_parlays(pick_status) WHERE pick_status = 'pending';