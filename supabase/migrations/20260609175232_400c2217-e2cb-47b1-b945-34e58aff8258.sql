ALTER TABLE public.sharp_line_tracker DROP CONSTRAINT IF EXISTS sharp_line_tracker_input_method_check;
ALTER TABLE public.sharp_line_tracker ADD CONSTRAINT sharp_line_tracker_input_method_check CHECK (input_method = ANY (ARRAY['manual'::text, 'scan'::text, 'auto'::text]));
CREATE INDEX IF NOT EXISTS idx_sharp_line_tracker_lookup ON public.sharp_line_tracker (sport, player_name, prop_type);