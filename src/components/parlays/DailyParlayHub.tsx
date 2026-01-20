import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, Sparkles } from "lucide-react";
import { useDailyParlays } from "@/hooks/useDailyParlays";
import { UnifiedParlayCard } from "./UnifiedParlayCard";

export function DailyParlayHub() {
  const { parlays, isLoading, parlayCount, today } = useDailyParlays();
  
  if (isLoading) {
    return <DailyParlayHubSkeleton />;
  }
  
  if (parlayCount === 0) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-8 text-center">
          <Target className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">No Parlays Available Yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Click "Refresh All Engines" to generate today's AI parlays
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="border-primary/20 overflow-hidden">
      <CardHeader className="pb-3 bg-gradient-to-r from-primary/10 to-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Today's Parlays</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="bg-primary/20 text-primary">
              {parlayCount} Ready
            </Badge>
            <Badge variant="outline" className="text-xs text-muted-foreground">
              {today}
            </Badge>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-3">
        {/* Responsive grid: 1 col mobile, 2 col tablet, 3 col desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {parlays.map(parlay => (
            <UnifiedParlayCard key={parlay.id} parlay={parlay} />
          ))}
        </div>
        
        {/* Summary stats */}
        <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <span>
            💰 {parlays.reduce((sum, p) => sum + p.legCount, 0)} Total Legs
          </span>
          <span>•</span>
          <span>
            🎯 Avg Win Prob: {(parlays.reduce((sum, p) => sum + p.winProbability, 0) / parlayCount * 100).toFixed(0)}%
          </span>
          <span>•</span>
          <span>
            🏀 {new Set(parlays.flatMap(p => p.legs.map(l => l.team))).size} Teams
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Loading skeleton
function DailyParlayHubSkeleton() {
  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardHeader>
      <CardContent className="p-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-2 pt-3 px-3">
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="px-3 pb-3 space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-6 w-12" />
                </div>
                <div className="flex gap-1">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
