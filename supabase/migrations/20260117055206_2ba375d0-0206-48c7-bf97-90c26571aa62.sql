-- Create category_sweet_spots table for L10 hit rate analysis
CREATE TABLE public.category_sweet_spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  recommended_line NUMERIC,
  recommended_side TEXT,
  l10_hit_rate NUMERIC,
  l10_avg NUMERIC,
  l10_min NUMERIC,
  l10_max NUMERIC,
  l10_median NUMERIC,
  games_played INTEGER DEFAULT 10,
  archetype TEXT,
  confidence_score NUMERIC,
  analysis_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_category_sweet_spots_category ON public.category_sweet_spots(category);
CREATE INDEX idx_category_sweet_spots_player ON public.category_sweet_spots(player_name);
CREATE INDEX idx_category_sweet_spots_date ON public.category_sweet_spots(analysis_date);
CREATE INDEX idx_category_sweet_spots_active ON public.category_sweet_spots(is_active) WHERE is_active = true;

-- Add unique constraint to prevent duplicates
CREATE UNIQUE INDEX idx_category_sweet_spots_unique 
ON public.category_sweet_spots(player_name, prop_type, analysis_date);

-- Enable RLS
ALTER TABLE public.category_sweet_spots ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Allow public read access to category_sweet_spots"
ON public.category_sweet_spots FOR SELECT
USING (true);

-- Add l10_hit_rate column to nba_risk_engine_picks if not exists
ALTER TABLE public.nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS l10_hit_rate NUMERIC,
ADD COLUMN IF NOT EXISTS l10_avg NUMERIC,
ADD COLUMN IF NOT EXISTS l10_games_used INTEGER;