-- Phase 1: Add outcome tracking to sharp_line_tracker for God Mode accuracy verification
ALTER TABLE sharp_line_tracker 
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IN ('won', 'lost', 'push', 'pending')),
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS was_correct boolean;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sharp_line_tracker_outcome ON sharp_line_tracker(outcome);
CREATE INDEX IF NOT EXISTS idx_sharp_line_tracker_verified ON sharp_line_tracker(verified_at);
CREATE INDEX IF NOT EXISTS idx_sharp_line_tracker_ai_direction ON sharp_line_tracker(ai_direction);
CREATE INDEX IF NOT EXISTS idx_sharp_line_tracker_commence ON sharp_line_tracker(commence_time);

-- Phase 1.2: Create sharp_tracker_accuracy_metrics table for aggregated accuracy
CREATE TABLE IF NOT EXISTS sharp_tracker_accuracy_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport text,
  ai_recommendation text,
  ai_direction text,
  confidence_bucket text,
  total_predictions integer DEFAULT 0,
  total_won integer DEFAULT 0,
  total_lost integer DEFAULT 0,
  total_push integer DEFAULT 0,
  win_rate numeric,
  roi_percentage numeric,
  avg_confidence numeric,
  sample_size_confidence text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sport, ai_recommendation, ai_direction, confidence_bucket)
);

-- Enable RLS on the new table
ALTER TABLE sharp_tracker_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Allow read access for all authenticated users
CREATE POLICY "Allow read access for authenticated users" 
  ON sharp_tracker_accuracy_metrics FOR SELECT 
  TO authenticated 
  USING (true);

-- Allow all access for service role
CREATE POLICY "Allow full access for service role" 
  ON sharp_tracker_accuracy_metrics FOR ALL 
  TO service_role 
  USING (true);

-- Phase 1.3: Add composite index for juiced_props filtering by tier
CREATE INDEX IF NOT EXISTS idx_juiced_props_unified_tier ON juiced_props(unified_pvs_tier);
CREATE INDEX IF NOT EXISTS idx_juiced_props_unified_confidence ON juiced_props(unified_confidence);

-- Update trigger for sharp_tracker_accuracy_metrics
CREATE OR REPLACE FUNCTION update_sharp_tracker_metrics_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sharp_tracker_metrics_updated_at
  BEFORE UPDATE ON sharp_tracker_accuracy_metrics
  FOR EACH ROW
  EXECUTE FUNCTION update_sharp_tracker_metrics_timestamp();