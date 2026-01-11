import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getEasternDate } from "@/lib/dateUtils";

interface ParlayLeg {
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  book_name: string;
  final_score: number;
  signal_label: string;
  reason: string;
  event_id: string;
  sport: string;
}

interface HeatParlay {
  id: string;
  parlay_date: string;
  parlay_type: 'CORE' | 'UPSIDE';
  leg_1: ParlayLeg;
  leg_2: ParlayLeg;
  summary: string;
  risk_level: string;
  no_bet_flags: string[];
}

export interface WatchlistItem {
  id: string;
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  sport: string;
  signal_label: string;
  approaching_entry: boolean;
  final_score: number;
  reason: string;
}

export interface DoNotBetItem {
  id: string;
  player_name: string;
  market_type: string;
  line: number;
  side: string;
  sport: string;
  trap_reason: string;
  final_score: number;
}

interface HeatEngineResult {
  success: boolean;
  core_parlay: HeatParlay | null;
  upside_parlay: HeatParlay | null;
  watchlist: WatchlistItem[];
  do_not_bet: DoNotBetItem[];
  message?: string;
  error?: string;
}

// Direct database query for Watchlist - updates in real-time
export function useHeatWatchlist() {
  const today = getEasternDate();
  
  return useQuery({
    queryKey: ['heat-watchlist', today],
    queryFn: async (): Promise<WatchlistItem[]> => {
      const { data, error } = await supabase
        .from('heat_watchlist')
        .select('*')
        .gte('watchlist_date', today)
        .order('final_score', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // 30 second backup polling
  });
}

// Direct database query for Do Not Bet - updates in real-time
export function useHeatDoNotBet() {
  const today = getEasternDate();
  
  return useQuery({
    queryKey: ['heat-do-not-bet', today],
    queryFn: async (): Promise<DoNotBetItem[]> => {
      const { data, error } = await supabase
        .from('heat_do_not_bet')
        .select('*')
        .gte('dnb_date', today)
        .order('final_score', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });
}

export function useHeatPropEngine(sport?: string) {
  return useQuery({
    queryKey: ['heat-prop-engine', sport],
    queryFn: async (): Promise<HeatEngineResult> => {
      const { data, error } = await supabase.functions.invoke('heat-prop-engine', {
        body: { action: 'fetch', sport }
      });
      
      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes
  });
}

export function useHeatEngineScan() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (sport?: string) => {
      // First scan/ingest props
      const { data: scanData, error: scanError } = await supabase.functions.invoke('heat-prop-engine', {
        body: { action: 'scan', sport }
      });
      
      if (scanError) throw scanError;
      
      console.log('[Heat Engine] Scan result:', scanData);
      
      // Then build parlays
      const { data: buildData, error: buildError } = await supabase.functions.invoke('heat-prop-engine', {
        body: { action: 'build', sport }
      });
      
      if (buildError) throw buildError;
      
      return buildData;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['heat-prop-engine'] });
      
      const hasCore = !!data.core_parlay;
      const hasUpside = !!data.upside_parlay;
      
      if (hasCore || hasUpside) {
        toast.success('Heat Engine parlays built', {
          description: `CORE: ${hasCore ? '✓' : '✗'} | UPSIDE: ${hasUpside ? '✓' : '✗'}`
        });
      } else {
        toast.warning('No parlays built', {
          description: data.message || 'Insufficient eligible props for today'
        });
      }
    },
    onError: (error: Error) => {
      toast.error('Heat Engine scan failed', {
        description: error.message
      });
    }
  });
}

export function useHeatTrackerStats() {
  const today = getEasternDate();
  
  return useQuery({
    queryKey: ['heat-tracker-stats', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('heat_prop_tracker')
        .select('*')
        .gte('start_time_utc', today);
      
      if (error) throw error;
      
      const totalProps = data?.length || 0;
      const eligibleCore = data?.filter(p => p.is_eligible_core).length || 0;
      const eligibleUpside = data?.filter(p => p.is_eligible_upside).length || 0;
      const strongSharp = data?.filter(p => p.signal_label === 'STRONG_SHARP').length || 0;
      const publicTraps = data?.filter(p => p.signal_label === 'PUBLIC_TRAP').length || 0;
      
      return {
        totalProps,
        eligibleCore,
        eligibleUpside,
        strongSharp,
        publicTraps,
        lastUpdated: new Date().toISOString()
      };
    },
    staleTime: 1000 * 60 * 2,
  });
}
