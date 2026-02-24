
-- Deduplicate: keep only the most recent row per (category, research_date)
DELETE FROM public.bot_research_findings
WHERE id NOT IN (
  SELECT DISTINCT ON (category, research_date) id
  FROM public.bot_research_findings
  ORDER BY category, research_date, updated_at DESC
);

-- Add unique constraint
ALTER TABLE public.bot_research_findings
ADD CONSTRAINT uq_research_findings_category_date UNIQUE (category, research_date);
