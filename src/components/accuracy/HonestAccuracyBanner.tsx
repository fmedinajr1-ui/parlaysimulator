import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, TrendingDown, Info } from "lucide-react";

interface ParlayRecord {
  won: number;
  lost: number;
  winRate: number;
  isLoading: boolean;
}

function useParlayRecord(daysBack: number): ParlayRecord {
  const { data, isLoading } = useQuery({
    queryKey: ['honest-parlay-record', daysBack],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysBack);
      
      const { data, error } = await supabase
        .from('bot_daily_parlays')
        .select('outcome')
        .gte('parlay_date', cutoff.toISOString().split('T')[0])
        .in('outcome', ['won', 'lost']);
      
      if (error) throw error;
      
      const won = (data || []).filter(p => p.outcome === 'won').length;
      const lost = (data || []).filter(p => p.outcome === 'lost').length;
      const total = won + lost;
      
      return { won, lost, winRate: total > 0 ? (won / total) * 100 : 0 };
    },
    staleTime: 1000 * 60 * 5,
  });

  return {
    won: data?.won ?? 0,
    lost: data?.lost ?? 0,
    winRate: data?.winRate ?? 0,
    isLoading,
  };
}

interface HonestAccuracyBannerProps {
  daysBack: number;
}

export function HonestAccuracyBanner({ daysBack }: HonestAccuracyBannerProps) {
  const record = useParlayRecord(daysBack);
  const total = record.won + record.lost;
  
  if (record.isLoading || total === 0) return null;

  const isHot = record.winRate >= 30;
  const isCold = record.winRate < 20;

  return (
    <Card className={`p-4 border ${
      isCold ? 'bg-red-500/5 border-red-500/30' :
      isHot ? 'bg-green-500/5 border-green-500/30' :
      'bg-card/50 border-border/50'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isCold ? (
            <TrendingDown className="w-4 h-4 text-red-400" />
          ) : (
            <TrendingUp className="w-4 h-4 text-green-400" />
          )}
          <span className="font-semibold text-sm">Actual Parlay Record</span>
        </div>
        <Badge variant="outline" className={`text-xs ${
          isCold ? 'text-red-400 border-red-500/30' :
          isHot ? 'text-green-400 border-green-500/30' :
          'text-yellow-400 border-yellow-500/30'
        }`}>
          {record.winRate.toFixed(1)}% Win Rate
        </Badge>
      </div>
      
      <div className="flex items-center gap-4 text-sm">
        <span className="text-green-400 font-medium">{record.won}W</span>
        <span className="text-red-400 font-medium">{record.lost}L</span>
        <span className="text-muted-foreground">({total} settled, last {daysBack}d)</span>
      </div>

      {isCold && (
        <div className="flex items-start gap-2 mt-3 p-2 rounded-lg bg-red-500/10">
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs text-red-300">
            System is on a cold streak. Accuracy numbers below reflect line movement (CLV), not actual bet wins.
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 mt-2 p-2 rounded-lg bg-muted/20">
        <Info className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
        <span className="text-xs text-muted-foreground">
          System accuracy below measures line movement direction (CLV) — not whether the bet won. Use this record as the real benchmark.
        </span>
      </div>
    </Card>
  );
}
