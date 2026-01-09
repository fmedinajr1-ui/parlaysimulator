import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useHeatPropRealtime() {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    const watchlistChannel = supabase
      .channel('heat-watchlist-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'heat_watchlist'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['heat-watchlist'] });
      })
      .subscribe();
      
    const dnbChannel = supabase
      .channel('heat-dnb-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'heat_do_not_bet'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['heat-do-not-bet'] });
      })
      .subscribe();

    const trackerChannel = supabase
      .channel('heat-tracker-realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'heat_prop_tracker'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['heat-prop-engine'] });
        queryClient.invalidateQueries({ queryKey: ['heat-tracker-stats'] });
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(watchlistChannel);
      supabase.removeChannel(dnbChannel);
      supabase.removeChannel(trackerChannel);
    };
  }, [queryClient]);
}
