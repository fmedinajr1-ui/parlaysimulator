import { Card, CardContent } from "@/components/ui/card";
import { Trophy, XCircle, MinusCircle, TrendingUp, Clock, Target, Zap, Flame } from "lucide-react";
import { ArchiveStats } from "@/hooks/useArchiveResults";
import { cn } from "@/lib/utils";

interface ArchiveStatsCardProps {
  stats: ArchiveStats;
}

const engineConfig: Record<string, { label: string; icon: typeof Target; color: string }> = {
  risk: { label: 'Risk Engine', icon: Target, color: 'text-blue-400' },
  sharp: { label: 'Sharp AI', icon: Zap, color: 'text-amber-400' },
  heat: { label: 'Heat Engine', icon: Flame, color: 'text-orange-400' },
};

export function ArchiveStatsCard({ stats }: ArchiveStatsCardProps) {
  return (
    <div className="space-y-4">
      {/* Main Stats Banner */}
      <Card className="bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
        <CardContent className="py-4">
          <div className="grid grid-cols-5 gap-4 text-center">
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <Trophy className="w-4 h-4 text-green-400" />
                <span className="text-2xl font-bold text-green-400">{stats.totalHits}</span>
              </div>
              <span className="text-xs text-muted-foreground">Wins</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-2xl font-bold text-red-400">{stats.totalMisses}</span>
              </div>
              <span className="text-xs text-muted-foreground">Losses</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <MinusCircle className="w-4 h-4 text-amber-400" />
                <span className="text-2xl font-bold text-amber-400">{stats.totalPushes}</span>
              </div>
              <span className="text-xs text-muted-foreground">Pushes</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-blue-400" />
                <span className="text-2xl font-bold text-blue-400">{stats.totalPending}</span>
              </div>
              <span className="text-xs text-muted-foreground">Pending</span>
            </div>
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-2xl font-bold text-primary">
                  {stats.hitRate.toFixed(1)}%
                </span>
              </div>
              <span className="text-xs text-muted-foreground">Win Rate</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Breakdown */}
      {Object.keys(stats.byEngine).length > 0 && (
        <Card className="border-border/50">
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Engine Breakdown</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(stats.byEngine).map(([engine, engineStats]) => {
                const config = engineConfig[engine] || { label: engine, icon: Target, color: 'text-muted-foreground' };
                const Icon = config.icon;
                
                return (
                  <div 
                    key={engine}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-4 h-4", config.color)} />
                      <span className="font-medium text-sm">{config.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-green-400">{engineStats.hits}W</span>
                      <span className="text-red-400">{engineStats.misses}L</span>
                      {engineStats.pending > 0 && (
                        <span className="text-blue-400">{engineStats.pending}P</span>
                      )}
                      <span className={cn(
                        "font-bold",
                        engineStats.hitRate >= 55 ? "text-green-400" : 
                        engineStats.hitRate >= 45 ? "text-amber-400" : "text-red-400"
                      )}>
                        {engineStats.hitRate.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prop Type Breakdown */}
      {Object.keys(stats.propTypeBreakdown).length > 0 && (
        <Card className="border-border/50">
          <CardContent className="py-4">
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Prop Type Performance</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(stats.propTypeBreakdown)
                .sort((a, b) => (b[1].hits + b[1].misses) - (a[1].hits + a[1].misses))
                .slice(0, 8)
                .map(([propType, propStats]) => (
                  <div 
                    key={propType}
                    className="flex flex-col p-2 rounded-md bg-muted/20 text-center"
                  >
                    <span className="text-xs text-muted-foreground truncate">{propType}</span>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <span className="text-xs text-green-400">{propStats.hits}W</span>
                      <span className="text-xs text-muted-foreground">-</span>
                      <span className="text-xs text-red-400">{propStats.misses}L</span>
                    </div>
                    <span className={cn(
                      "text-sm font-bold mt-0.5",
                      propStats.hitRate >= 55 ? "text-green-400" : 
                      propStats.hitRate >= 45 ? "text-amber-400" : "text-red-400"
                    )}>
                      {propStats.hitRate.toFixed(0)}%
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
