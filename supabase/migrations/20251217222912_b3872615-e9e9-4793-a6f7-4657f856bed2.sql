-- Enable realtime for pilot_user_quotas so credits update automatically
ALTER PUBLICATION supabase_realtime ADD TABLE public.pilot_user_quotas;