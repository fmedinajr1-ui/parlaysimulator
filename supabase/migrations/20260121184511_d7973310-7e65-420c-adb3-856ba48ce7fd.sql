-- Create parlay_drafts table for shareable draft links
CREATE TABLE public.parlay_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,
  creator_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Parlay Draft',
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days')
);

-- Create draft_suggestions table for friend suggestions
CREATE TABLE public.draft_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.parlay_drafts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  suggested_leg JSONB NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('over', 'under')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.parlay_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_suggestions ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX idx_parlay_drafts_share_code ON public.parlay_drafts(share_code);
CREATE INDEX idx_parlay_drafts_creator ON public.parlay_drafts(creator_id);
CREATE INDEX idx_draft_suggestions_draft ON public.draft_suggestions(draft_id);

-- RLS Policies for parlay_drafts
-- Anyone can view drafts (for shareable links)
CREATE POLICY "Drafts are publicly viewable"
ON public.parlay_drafts
FOR SELECT
USING (true);

-- Only creator can insert their own drafts
CREATE POLICY "Users can create their own drafts"
ON public.parlay_drafts
FOR INSERT
WITH CHECK (auth.uid() = creator_id);

-- Only creator can update their drafts
CREATE POLICY "Users can update their own drafts"
ON public.parlay_drafts
FOR UPDATE
USING (auth.uid() = creator_id);

-- Only creator can delete their drafts
CREATE POLICY "Users can delete their own drafts"
ON public.parlay_drafts
FOR DELETE
USING (auth.uid() = creator_id);

-- RLS Policies for draft_suggestions
-- Anyone can view suggestions on a draft
CREATE POLICY "Suggestions are viewable by all"
ON public.draft_suggestions
FOR SELECT
USING (true);

-- Logged in users can suggest on any draft
CREATE POLICY "Logged in users can suggest"
ON public.draft_suggestions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Only draft creator can update suggestion status
CREATE POLICY "Draft creator can update suggestions"
ON public.draft_suggestions
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.parlay_drafts 
    WHERE id = draft_id AND creator_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_parlay_drafts_updated_at
BEFORE UPDATE ON public.parlay_drafts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for suggestions
ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_suggestions;