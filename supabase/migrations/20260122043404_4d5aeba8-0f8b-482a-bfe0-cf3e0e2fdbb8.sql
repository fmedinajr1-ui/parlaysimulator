-- Enable realtime for unified_props table so Manual Builder auto-updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.unified_props;