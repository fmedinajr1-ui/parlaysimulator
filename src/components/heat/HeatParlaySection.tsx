import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { HeatParlayCard } from "./HeatParlayCard";
import { useHeatEngineScan } from "@/hooks/useHeatPropEngine";
import { Button } from "@/components/ui/button";
import { Flame, RefreshCw } from "lucide-react";
import { SkeletonCard } from "@/components/ui/skeleton-card";

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

export function HeatParlaySection() {
  const today = new Date().toISOString().split('T')[0];
  
  const { data: parlays, isLoading, refetch } = useQuery({
    queryKey: ['heat-parlays-homepage', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('heat_parlays')
        .select('*')
        .eq('parlay_date', today);
      
      if (error) throw error;
      
      // Filter out stale parlays that have already been settled
      const freshParlays = (data || []).filter((p: any) => {
        // Check if legs have outcome set (meaning they're settled/stale)
        const leg1Settled = p.leg_1?.outcome && p.leg_1.outcome !== 'pending';
        const leg2Settled = p.leg_2?.outcome && p.leg_2.outcome !== 'pending';
        return !leg1Settled && !leg2Settled;
      });
      
      return freshParlays as unknown as HeatParlay[];
    },
    refetchInterval: 60000,
  });

  const scanMutation = useHeatEngineScan();

  const coreParlay = parlays?.find(p => p.parlay_type === 'CORE') || null;
  const upsideParlay = parlays?.find(p => p.parlay_type === 'UPSIDE') || null;
  
  // Check if we have NO fresh parlays (all were stale or none exist)
  const hasNoParlays = !isLoading && !coreParlay && !upsideParlay;

  const handleScanAndBuild = () => {
    scanMutation.mutate(undefined, {
      onSuccess: () => {
        // Refetch parlays after successful scan
        refetch();
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          <h2 className="text-lg font-semibold">Heat Engine Parlays</h2>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            2-MAN
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleScanAndBuild}
          disabled={scanMutation.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${scanMutation.isPending ? 'animate-spin' : ''}`} />
          {scanMutation.isPending ? 'Scanning...' : 'Scan & Build'}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SkeletonCard variant="bet" />
          <SkeletonCard variant="bet" />
        </div>
      ) : hasNoParlays ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-center">
          <Flame className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm font-medium text-muted-foreground">No Parlays Available</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Click "Scan & Build" to generate today's parlays
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <HeatParlayCard parlay={coreParlay} type="CORE" />
          <HeatParlayCard parlay={upsideParlay} type="UPSIDE" />
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Market signal analysis from live odds movement • Role-player focused
      </p>
    </div>
  );
}
