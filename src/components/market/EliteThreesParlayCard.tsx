import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Plus, Loader2, TrendingUp, Crosshair } from "lucide-react";
import { useEliteThreesBuilder } from "@/hooks/useEliteThreesBuilder";
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

export function EliteThreesParlayCard() {
  const { 
    eliteThreesPicks, 
    isLoading, 
    combinedProbability,
    theoreticalOdds,
    addEliteThreesToBuilder,
    legCount,
    avgL10HitRate,
    uniqueTeams,
  } = useEliteThreesBuilder();

  if (isLoading) {
    return (
      <Card className="border-violet-500/30 bg-gradient-to-br from-background to-violet-500/5">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (eliteThreesPicks.length === 0) {
    return (
      <Card className="border-muted/50 bg-muted/5">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center">
          <Crosshair className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No 97%+ L10 3PT picks today</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-background via-violet-500/5 to-background overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-500/20">
              <Crosshair className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">🎯 Elite 3PT Parlay</CardTitle>
              <p className="text-[10px] text-muted-foreground">97%+ L10 hit rate only</p>
            </div>
          </div>
          <Button 
            size="sm" 
            onClick={addEliteThreesToBuilder}
            className="gap-1 h-7 text-xs bg-violet-600 hover:bg-violet-700"
          >
            <Plus className="h-3 w-3" />
            Add {legCount}-Leg
          </Button>
        </div>

        {/* Stats Row */}
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge variant="outline" className="gap-1 bg-violet-500/10 text-violet-400 border-violet-500/30 text-[10px]">
            <Target className="h-3 w-3" />
            {legCount} Legs
          </Badge>
          <Badge variant="outline" className="gap-1 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
            <TrendingUp className="h-3 w-3" />
            {(avgL10HitRate * 100).toFixed(0)}% Avg L10
          </Badge>
          <Badge variant="outline" className="gap-1 bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
            {uniqueTeams} Teams
          </Badge>
          <Badge variant="outline" className="gap-1 bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
            {(combinedProbability * 100).toFixed(0)}% Win ({theoreticalOdds})
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 pt-0">
        <div className="space-y-1.5">
          {eliteThreesPicks.map((pick, index) => (
            <div 
              key={pick.id} 
              className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50"
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold">
                  {index + 1}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-xs">{pick.player_name}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {pick.team}
                    </Badge>
                    {pick.reliabilityTier ? (
                      <PlayerReliabilityBadge 
                        tier={pick.reliabilityTier}
                        hitRate={pick.reliabilityHitRate}
                        size="sm"
                      />
                    ) : (
                      <Badge className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30">
                        NEW
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge className="text-[9px] px-1 py-0 bg-violet-500/20 text-violet-400 border-violet-500/30">
                      3PT
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      O {pick.line}
                    </span>
                    {pick.edge && pick.edge > 0 && (
                      <Badge className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-400 border-0">
                        +{pick.edge.toFixed(1)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-bold text-emerald-400">
                  {(pick.l10HitRate * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-muted-foreground">L10</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
