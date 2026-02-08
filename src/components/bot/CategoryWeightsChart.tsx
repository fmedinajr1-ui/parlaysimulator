/**
 * CategoryWeightsChart.tsx
 * 
 * Visualizes category weights with color-coded bars.
 */

import React from 'react';
import { Scale, AlertTriangle, TrendingUp, Ban } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { CategoryWeight } from '@/hooks/useBotEngine';

interface CategoryWeightsChartProps {
  weights: CategoryWeight[];
}

export function CategoryWeightsChart({ weights }: CategoryWeightsChartProps) {
  // Sort by weight descending, blocked at bottom
  const sortedWeights = [...weights].sort((a, b) => {
    if (a.is_blocked && !b.is_blocked) return 1;
    if (!a.is_blocked && b.is_blocked) return -1;
    return b.weight - a.weight;
  });

  const getWeightColor = (weight: number, isBlocked: boolean): string => {
    if (isBlocked) return 'bg-red-500/50';
    if (weight >= 1.2) return 'bg-green-500';
    if (weight >= 1.0) return 'bg-primary';
    if (weight >= 0.8) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getWeightBadge = (weight: number, isBlocked: boolean) => {
    if (isBlocked) {
      return (
        <Badge variant="destructive" className="text-xs">
          <Ban className="w-3 h-3 mr-1" />
          Blocked
        </Badge>
      );
    }
    if (weight >= 1.2) {
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/50 text-xs">
          <TrendingUp className="w-3 h-3 mr-1" />
          Boosted
        </Badge>
      );
    }
    if (weight < 0.8) {
      return (
        <Badge variant="secondary" className="text-amber-400 text-xs">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Caution
        </Badge>
      );
    }
    return null;
  };

  const getStreakDisplay = (streak: number) => {
    if (streak === 0) return null;
    if (streak > 0) {
      return (
        <span className="text-green-400 text-xs">
          🔥 {streak}W
        </span>
      );
    }
    return (
      <span className="text-red-400 text-xs">
        ❄️ {Math.abs(streak)}L
      </span>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            Category Weights
          </CardTitle>
          <Badge variant="outline">
            {weights.filter(w => !w.is_blocked).length} active
          </Badge>
        </div>
        <CardDescription>
          Dynamic weights adjust based on outcomes (0.5-1.5 range)
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {sortedWeights.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            No category weights loaded
          </div>
        ) : (
          sortedWeights.map((cat) => {
            const progressValue = (cat.weight / 1.5) * 100;
            
            return (
              <div key={cat.id} className={cn(
                "space-y-1.5 p-2 rounded-lg",
                cat.is_blocked && "opacity-60 bg-muted/30"
              )}>
                {/* Category Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{cat.category}</span>
                    <span className="text-xs text-muted-foreground uppercase">
                      {cat.side}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStreakDisplay(cat.current_streak)}
                    {getWeightBadge(cat.weight, cat.is_blocked)}
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        getWeightColor(cat.weight, cat.is_blocked)
                      )}
                      style={{ width: `${progressValue}%` }}
                    />
                  </div>
                  <span className={cn(
                    "text-sm font-mono w-10 text-right",
                    cat.is_blocked ? "text-red-400" : 
                    cat.weight >= 1.0 ? "text-green-400" : "text-amber-400"
                  )}>
                    {cat.weight.toFixed(2)}
                  </span>
                </div>
                
                {/* Stats Row */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {cat.total_hits}/{cat.total_picks} picks ({(cat.current_hit_rate || 0).toFixed(1)}%)
                  </span>
                  {cat.block_reason && (
                    <span className="text-red-400 truncate max-w-[150px]">
                      {cat.block_reason}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
        
        {/* Legend */}
        <div className="pt-3 border-t border-border/50 flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-500" />
            <span className="text-muted-foreground">Boosted (≥1.2)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-primary" />
            <span className="text-muted-foreground">Normal (≥1.0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-amber-500" />
            <span className="text-muted-foreground">Caution (0.8-1.0)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-red-500/50" />
            <span className="text-muted-foreground">Blocked</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
