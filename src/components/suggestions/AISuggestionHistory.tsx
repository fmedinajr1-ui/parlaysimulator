import { useSuggestedParlayStats } from "@/hooks/useSuggestedParlayStats";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Loader2, Flame, Zap, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react";
import { formatUnits } from "@/utils/roiCalculator";
import { useState } from "react";

function formatOdds(odds: number): string {
  if (odds >= 2) {
    return `+${Math.round((odds - 1) * 100)}`;
  }
  return `-${Math.round(100 / (odds - 1))}`;
}

export function AISuggestionHistory() {
  const { parlays, stats, isLoading, refreshResults } = useSuggestedParlayStats();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'won' | 'lost' | 'pending'>('all');

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshResults();
    setIsRefreshing(false);
  };

  const filteredParlays = parlays.filter(p => {
    if (filter === 'all') return true;
    return p.outcome === filter;
  });

  const settledParlays = parlays.filter(p => p.outcome === 'won' || p.outcome === 'lost');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Streak Info */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Flame className={`w-4 h-4 ${stats.currentStreak.type === 'W' ? 'text-green-500' : stats.currentStreak.type === 'L' ? 'text-red-500' : 'text-muted-foreground'}`} />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Current</span>
            </div>
            <div className={`text-2xl font-display font-bold ${stats.currentStreak.type === 'W' ? 'text-green-500' : stats.currentStreak.type === 'L' ? 'text-red-500' : 'text-muted-foreground'}`}>
              {stats.currentStreak.count > 0 ? `${stats.currentStreak.count}${stats.currentStreak.type}` : '-'}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Best / Worst</span>
            </div>
            <div className="text-2xl font-display font-bold">
              <span className="text-green-500">{stats.bestWinStreak}W</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-red-500">{stats.worstLossStreak}L</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overall Record */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display">AI SUGGESTION RECORD</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-2xl font-bold text-green-500">{stats.wonParlays}</div>
              <div className="text-xs text-muted-foreground">Won</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-500">{stats.lostParlays}</div>
              <div className="text-xs text-muted-foreground">Lost</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-500">{stats.pendingParlays}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-foreground">{stats.winRate.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </div>
          </div>

          {settledParlays.length > 0 && (
            <>
              <Progress value={stats.winRate} className="h-2" />
              
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">ROI</span>
                <span className={stats.totalUnits >= 0 ? 'text-green-500 font-medium' : 'text-red-500 font-medium'}>
                  {formatUnits(stats.totalUnits)} ({stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%)
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* History List */}
      <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
        <TabsList className="w-full grid grid-cols-4 h-9">
          <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          <TabsTrigger value="won" className="text-xs">Won</TabsTrigger>
          <TabsTrigger value="lost" className="text-xs">Lost</TabsTrigger>
          <TabsTrigger value="pending" className="text-xs">Pending</TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-4 space-y-3">
          {filteredParlays.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No {filter !== 'all' ? filter : ''} suggestions yet
            </div>
          ) : (
            filteredParlays.slice(0, 20).map((parlay) => (
              <ParlayHistoryCard key={parlay.id} parlay={parlay} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ParlayHistoryCard({ parlay }: { parlay: any }) {
  const [expanded, setExpanded] = useState(false);

  const getOutcomeIcon = () => {
    switch (parlay.outcome) {
      case 'won': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'lost': return <XCircle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getOutcomeBadge = () => {
    switch (parlay.outcome) {
      case 'won': return <Badge className="bg-green-500/20 text-green-500 border-green-500/30">WON</Badge>;
      case 'lost': return <Badge className="bg-red-500/20 text-red-500 border-red-500/30">LOST</Badge>;
      default: return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">PENDING</Badge>;
    }
  };

  return (
    <Card 
      className="bg-card/50 border-border/50 cursor-pointer hover:bg-card/70 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {getOutcomeIcon()}
            <div>
              <div className="font-medium text-sm">
                {parlay.legs.length}-Leg {parlay.sport} Parlay
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(parlay.created_at).toLocaleDateString()} • {formatOdds(parlay.total_odds)}
              </div>
            </div>
          </div>
          {getOutcomeBadge()}
        </div>

        {expanded && (
          <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
            {parlay.legs.map((leg: any, i: number) => {
              const legOutcome = parlay.leg_outcomes?.find((lo: any) => lo.legIndex === i);
              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {legOutcome?.outcome === 'hit' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : legOutcome?.outcome === 'miss' ? (
                      <XCircle className="w-4 h-4 text-red-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-foreground/90">
                      {leg.description || `${leg.playerName || leg.player_name} ${leg.side || 'OVER'} ${leg.line}`}
                    </span>
                  </div>
                  {legOutcome?.actualValue !== undefined && legOutcome?.actualValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      Actual: {legOutcome.actualValue}
                    </span>
                  )}
                </div>
              );
            })}
            <div className="text-xs text-muted-foreground pt-2 border-t border-border/30">
              {parlay.suggestion_reason}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
