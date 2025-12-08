-- Add unified intelligence columns to juiced_props
ALTER TABLE public.juiced_props 
ADD COLUMN IF NOT EXISTS unified_composite_score NUMERIC,
ADD COLUMN IF NOT EXISTS unified_pvs_tier TEXT,
ADD COLUMN IF NOT EXISTS unified_recommendation TEXT,
ADD COLUMN IF NOT EXISTS unified_confidence NUMERIC,
ADD COLUMN IF NOT EXISTS unified_trap_score NUMERIC,
ADD COLUMN IF NOT EXISTS used_unified_intelligence BOOLEAN DEFAULT false;