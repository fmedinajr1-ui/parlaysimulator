import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEasternDate } from "@/lib/dateUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  AlertTriangle,
  Check,
  X,
  RefreshCw,
  Zap
} from "lucide-react";
import { toast } from "sonner";

interface PropEngineV2Pick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  line_structure: string;
  side: string;
  ses_score: number;
  decision: 'BET' | 'LEAN' | 'NO_BET';
  decision_emoji: string;
  key_reason: string;
  player_archetype: string;
  market_type: string;
  rolling_median: number | null;
  median_gap: number | null;
  minutes_certainty: string;
  blowout_risk: boolean;
  auto_fail_reason: string | null;
  ses_components: Record<string, number> | null;
  team_name: string | null;
  opponent_name: string | null;
  odds: number | null;
  outcome: string;
  created_at: string;
}

function getSESColor(ses: number): string {
  if (ses >= 72) return "text-green-500";
  if (ses >= 64) return "text-yellow-500";
  return "text-muted-foreground";
}

function getSESBgColor(ses: number): string {
  if (ses >= 72) return "bg-green-500/20 border-green-500/30";
  if (ses >= 64) return "bg-yellow-500/20 border-yellow-500/30";
  return "bg-muted/20 border-muted/30";
}

function getDecisionBadge(decision: string, emoji: string) {
  switch (decision) {
    case 'BET':
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
          <Check className="w-3 h-3" />
          {emoji} BET
        </Badge>
      );
    case 'LEAN':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
          <AlertTriangle className="w-3 h-3" />
          {emoji} LEAN
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <X className="w-3 h-3" />
          {emoji} NO BET
        </Badge>
      );
  }
}

function getArchetypeBadge(archetype: string) {
  const colors = {
    Guard: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    Wing: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    Big: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };
  return (
    <Badge className={colors[archetype as keyof typeof colors] || "bg-muted"}>
      {archetype}
    </Badge>
  );
}

function PickCard({ pick }: { pick: PropEngineV2Pick }) {
  const isOver = pick.side === 'over';
  
  return (
    <div className={`p-3 rounded-lg border ${getSESBgColor(pick.ses_score)} space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{pick.player_name}</span>
            {getArchetypeBadge(pick.player_archetype)}
          </div>
          <div className="flex items-center gap-2 mt-1 text-sm">
            <span className="text-muted-foreground">{pick.prop_type}</span>
            <span className={`font-medium ${isOver ? 'text-green-400' : 'text-red-400'}`}>
              {isOver ? <TrendingUp className="w-3 h-3 inline mr-1" /> : <TrendingDown className="w-3 h-3 inline mr-1" />}
              {pick.side.toUpperCase()} {pick.line}
            </span>
            <Badge variant="outline" className="text-xs">
              {pick.line_structure}
            </Badge>
          </div>
        </div>
        <div className="text-right shrink-0">
          {getDecisionBadge(pick.decision, pick.decision_emoji)}
          <div className={`text-lg font-bold mt-1 ${getSESColor(pick.ses_score)}`}>
            SES: {pick.ses_score}
          </div>
        </div>
      </div>
      
      {/* SES Progress Bar */}
      <div className="space-y-1">
        <Progress value={pick.ses_score} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0</span>
          <span className="text-yellow-500">64</span>
          <span className="text-green-500">72</span>
          <span>100</span>
        </div>
      </div>

      {/* Key Reason */}
      <p className="text-sm text-muted-foreground">
        {pick.key_reason}
      </p>

      {/* Metadata Row */}
      <div className="flex flex-wrap gap-1">
        {pick.market_type !== 'Standard' && (
          <Badge variant="outline" className="text-xs">
            {pick.market_type}
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {pick.minutes_certainty} mins
        </Badge>
        {pick.blowout_risk && (
          <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
            Blowout Risk
          </Badge>
        )}
        {pick.rolling_median && (
          <Badge variant="outline" className="text-xs">
            Median: {pick.rolling_median}
          </Badge>
        )}
      </div>

      {/* Auto-fail warning */}
      {pick.auto_fail_reason && (
        <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 border border-destructive/20">
          <Shield className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive">{pick.auto_fail_reason}</p>
        </div>
      )}
    </div>
  );
}

export function PropEngineV2Card() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['prop-engine-v2-picks'],
    queryFn: async () => {
      const today = getEasternDate();
      const { data, error } = await supabase
        .from('prop_engine_v2_picks')
        .select('*')
        .eq('game_date', today)
        .order('ses_score', { ascending: false });
      
      if (error) throw error;
      return (data || []) as unknown as PropEngineV2Pick[];
    },
    refetchInterval: 60000,
  });

  const handleRefresh = async () => {
    toast.info("Refreshing Prop Engine v2...");
    await refetch();
    toast.success("Picks refreshed!");
  };

  const picks = data || [];
  const bets = picks.filter(p => p.decision === 'BET');
  const leans = picks.filter(p => p.decision === 'LEAN');
  const passes = picks.filter(p => p.decision === 'NO_BET');
  const avgSES = picks.length > 0 
    ? Math.round(picks.reduce((sum, p) => sum + p.ses_score, 0) / picks.length)
    : 0;

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="w-5 h-5 text-primary" />
            Prop Engine v2.1
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-card border-destructive/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <Brain className="w-5 h-5" />
            Prop Engine v2.1 Error
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Failed to load picks</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="w-5 h-5 text-primary" />
            Prop Engine v2.1
            <Badge variant="outline" className="text-xs font-normal">
              Sharp-Aligned
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        
        {/* Summary Stats */}
        <div className="flex gap-3 mt-2 text-sm">
          <div className="flex items-center gap-1">
            <Check className="w-4 h-4 text-green-500" />
            <span className="text-green-500 font-medium">{bets.length}</span>
            <span className="text-muted-foreground">BET</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            <span className="text-yellow-500 font-medium">{leans.length}</span>
            <span className="text-muted-foreground">LEAN</span>
          </div>
          <div className="flex items-center gap-1">
            <X className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{passes.length}</span>
            <span className="text-muted-foreground">PASS</span>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-medium">{avgSES}</span>
            <span className="text-muted-foreground">Avg SES</span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {picks.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No picks analyzed today</p>
            <p className="text-xs">Engine will populate when props are scanned</p>
          </div>
        ) : (
          <>
            {/* Show BET picks first */}
            {bets.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-green-500 flex items-center gap-1">
                  <Check className="w-4 h-4" /> Sharp Bets
                </h4>
                {bets.slice(0, 3).map(pick => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            )}

            {/* Show LEAN picks */}
            {leans.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-yellow-500 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> Parlay Leans
                </h4>
                {leans.slice(0, 2).map(pick => (
                  <PickCard key={pick.id} pick={pick} />
                ))}
              </div>
            )}

            {/* Link to full view if many picks */}
            {picks.length > 5 && (
              <p className="text-xs text-center text-muted-foreground">
                + {picks.length - 5} more picks analyzed
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
