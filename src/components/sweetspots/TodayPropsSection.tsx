import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Users, Plus, TrendingUp, Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodayPropPick } from "@/hooks/useTodayProps";

interface TodayPropsSectionProps {
  threesPicks: TodayPropPick[];
  assistsPicks: TodayPropPick[];
  threesStats: {
    totalPicks: number;
    eliteCount: number;
    avgHitRate: number;
  };
  assistsStats: {
    totalPicks: number;
    eliteCount: number;
    avgHitRate: number;
  };
  isLoading: boolean;
  onAddToBuilder: (pick: TodayPropPick, propType: 'threes' | 'assists') => void;
}

export function TodayPropsSection({
  threesPicks,
  assistsPicks,
  threesStats,
  assistsStats,
  isLoading,
  onAddToBuilder,
}: TodayPropsSectionProps) {
  const [activeTab, setActiveTab] = useState<'threes' | 'assists'>('threes');

  if (isLoading) {
    return (
      <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const totalPicks = threesPicks.length + assistsPicks.length;
  if (totalPicks === 0) return null;

  const picks = activeTab === 'threes' ? threesPicks : assistsPicks;
  const stats = activeTab === 'threes' ? threesStats : assistsStats;

  // Helper: get display hit rate (actual_hit_rate when actual_line + actual_hit_rate exist)
  const displayHitRate = (p: TodayPropPick) =>
    p.actual_line != null && p.actual_hit_rate != null ? p.actual_hit_rate : p.l10_hit_rate;

  // Sort by display hit rate, then confidence
  const sortedPicks = [...picks].sort((a, b) => {
    const rateA = displayHitRate(a);
    const rateB = displayHitRate(b);
    if (rateB !== rateA) return rateB - rateA;
    return b.confidence_score - a.confidence_score;
  });

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-transparent">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-400" />
            Today's Props
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-500/30">
              <Target className="h-3 w-3 mr-1" />
              {threesPicks.length} 3PT
            </Badge>
            <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
              <Users className="h-3 w-3 mr-1" />
              {assistsPicks.length} AST
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'threes' | 'assists')}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="threes" className="gap-1.5">
              <Target className="h-3.5 w-3.5" />
              3-Pointers ({threesPicks.length})
            </TabsTrigger>
            <TabsTrigger value="assists" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Assists ({assistsPicks.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-3 space-y-2">
            {/* Stats summary */}
            {stats.totalPicks > 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2 px-1">
                <span>🔥 {stats.eliteCount} Elite (100% L10)</span>
                <span>Avg Hit Rate: {(stats.avgHitRate * 100).toFixed(0)}%</span>
              </div>
            )}

            {sortedPicks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No {activeTab === 'threes' ? '3-pointer' : 'assist'} picks for today
              </p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {sortedPicks.slice(0, 10).map((pick) => (
                  <PropPickCard
                    key={pick.id}
                    pick={pick}
                    propType={activeTab}
                    onAdd={() => onAddToBuilder(pick, activeTab)}
                  />
                ))}
                {sortedPicks.length > 10 && (
                  <p className="text-xs text-muted-foreground text-center pt-2">
                    + {sortedPicks.length - 10} more picks
                  </p>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface PropPickCardProps {
  pick: TodayPropPick;
  propType: 'threes' | 'assists';
  onAdd: () => void;
}

function PropPickCard({ pick, propType, onAdd }: PropPickCardProps) {
  // Display hit rate: use actual_hit_rate when we have actual_line, else l10_hit_rate
  const hitRate = (pick.actual_line != null && pick.actual_hit_rate != null) 
    ? pick.actual_hit_rate 
    : pick.l10_hit_rate;
  
  const isElite = hitRate >= 1;
  const isPremium = hitRate >= 0.9 && hitRate < 1;
  const line = pick.actual_line ?? pick.recommended_line;
  const edge = pick.edge;

  return (
    <div
      className={cn(
        "p-2.5 rounded-lg border flex items-center justify-between gap-2",
        isElite && "bg-amber-500/10 border-amber-500/30",
        isPremium && !isElite && "bg-teal-500/10 border-teal-500/30",
        !isElite && !isPremium && "bg-muted/50 border-border"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{pick.player_name}</span>
          {isElite && (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1 py-0">
              100%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          <span className={cn(
            "font-medium",
            pick.recommended_side === 'OVER' ? "text-green-400" : "text-red-400"
          )}>
            {pick.recommended_side} {line}
          </span>
          <span>•</span>
          <span>{pick.team}</span>
          {pick.l5_avg && (
            <>
              <span>•</span>
              <span className="flex items-center gap-0.5">
                <TrendingUp className="h-3 w-3" />
                L5: {pick.l5_avg.toFixed(1)}
              </span>
            </>
          )}
        </div>
        {edge !== null && edge > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <Shield className="h-3 w-3 text-green-400" />
            <span className="text-[10px] text-green-400">+{edge.toFixed(1)} edge</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="text-right">
          <div className={cn(
            "text-sm font-bold",
            isElite ? "text-amber-400" : isPremium ? "text-teal-400" : "text-foreground"
          )}>
            {(hitRate * 100).toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground">Hit Rate</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 hover:bg-violet-500/20"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
