CREATE POLICY "Allow public read access to research findings"
ON public.bot_research_findings
FOR SELECT
USING (true);