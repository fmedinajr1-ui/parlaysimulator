
-- Create table for AI research agent findings
CREATE TABLE public.bot_research_findings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  research_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL, -- 'competing_ai', 'statistical_models', 'injury_intel'
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_insights JSONB DEFAULT '[]',
  sources TEXT[] DEFAULT '{}',
  relevance_score NUMERIC(3,2) DEFAULT 0.50,
  actionable BOOLEAN DEFAULT false,
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by date and category
CREATE INDEX idx_research_findings_date ON public.bot_research_findings(research_date DESC);
CREATE INDEX idx_research_findings_category ON public.bot_research_findings(category);

-- Enable RLS (service role only - no user access needed)
ALTER TABLE public.bot_research_findings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions use service role key)
-- No user-facing policies needed since this is bot-internal data
