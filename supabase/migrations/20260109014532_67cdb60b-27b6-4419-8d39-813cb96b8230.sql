-- Enable realtime for heat tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.heat_watchlist;
ALTER PUBLICATION supabase_realtime ADD TABLE public.heat_do_not_bet;
ALTER PUBLICATION supabase_realtime ADD TABLE public.heat_prop_tracker;