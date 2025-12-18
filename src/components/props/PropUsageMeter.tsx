import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { UsageProjection } from "@/types/pvs";
import { Clock, TrendingUp, TrendingDown, Minus, Activity, Target } from "lucide-react";

interface PropUsageMeterProps {
  projection: UsageProjection;
  propType: string;
  line: number;
}

export function PropUsageMeter({ projection, propType, line }: PropUsageMeterProps) {
  // Early return if projection data is incomplete
  if (!projection) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Usage data unavailable for this prop
      </div>
    );
  }

  // Normalize the projection data structure - API returns projectedMinutes, component expects projectedStats
  const projectedStats = projection.projectedStats || (projection as any).projectedMinutes 
    ? {
        minMinutes: projection.projectedStats?.minMinutes ?? (projection as any).projectedMinutes?.min ?? 0,
        maxMinutes: projection.projectedStats?.maxMinutes ?? (projection as any).projectedMinutes?.max ?? 0
      }
    : null;

  const avgMinutes = projection.avgMinutes ?? (projection as any).projectedMinutes?.avg ?? 0;

  const getVerdictConfig = (verdict: string) => {
    switch (verdict) {
      case 'FAVORABLE':
        return { 
          color: 'text-emerald-400', 
          bg: 'bg-emerald-500/20', 
          border: 'border-emerald-500/30',
          icon: TrendingUp 
        };
      case 'UNFAVORABLE':
        return { 
          color: 'text-red-400', 
          bg: 'bg-red-500/20', 
          border: 'border-red-500/30',
          icon: TrendingDown 
        };
      default:
        return { 
          color: 'text-yellow-400', 
          bg: 'bg-yellow-500/20', 
          border: 'border-yellow-500/30',
          icon: Minus 
        };
    }
  };

  const verdictConfig = getVerdictConfig(projection.verdict || 'NEUTRAL');
  const VerdictIcon = verdictConfig.icon;
  
  const rawHitRate: unknown = projection.hitRate;
  let hitRate = 0;
  if (rawHitRate !== null && rawHitRate !== undefined) {
    if (typeof rawHitRate === 'object' && rawHitRate !== null && 'percentage' in rawHitRate) {
      hitRate = (rawHitRate as { percentage: number }).percentage / 100;
    } else if (typeof rawHitRate === 'number') {
      hitRate = rawHitRate;
    }
  }
  const efficiencyMargin = projection.efficiencyMargin ?? 0;
  
  const confidencePercent = Math.min(100, Math.max(0, 
    (hitRate * 100 + (efficiencyMargin > 0 ? 30 : 0)) / 1.3
  ));
  
  const getConfidenceColor = (percent: number) => {
    if (percent >= 70) return 'text-emerald-400';
    if (percent >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Calculate recent games display from game logs
  const recentGames = projection.gameLogs?.slice(0, 5) || [];
  const statKey = propType.includes('points') ? 'pts' : 
                  propType.includes('rebound') ? 'reb' : 
                  propType.includes('assist') ? 'ast' :
                  propType.includes('three') ? 'threes' : 'pts';

  return (
    <div className="space-y-3 pt-2">
      {/* Verdict Header */}
      <div className={cn(
        "flex items-center justify-between p-3 rounded-lg border",
        verdictConfig.bg,
        verdictConfig.border
      )}>
        <div className="flex items-center gap-2">
          <div className={cn(
            "flex items-center justify-center w-12 h-12 rounded-full border-2",
            verdictConfig.border
          )}>
            <span className={cn("text-xl font-bold font-mono", getConfidenceColor(confidencePercent))}>
              {confidencePercent.toFixed(0)}
            </span>
          </div>
          <div>
            <div className={cn("font-semibold flex items-center gap-1", verdictConfig.color)}>
              <VerdictIcon className="h-4 w-4" />
              {projection.verdict || 'NEUTRAL'} USAGE
            </div>
            <div className="text-xs text-muted-foreground">
              {efficiencyMargin >= 10 
                ? 'High efficiency buffer detected'
                : efficiencyMargin >= 0
                ? 'Adequate efficiency margin'
                : 'Low efficiency margin'}
            </div>
          </div>
        </div>
        <Badge variant="outline" className={cn("font-mono", verdictConfig.color)}>
          {hitRate >= 0.8 ? '🔥' : hitRate >= 0.6 ? '✅' : '⚠️'} 
          {' '}{(hitRate * 100).toFixed(0)}% hit
        </Badge>
      </div>

      {/* Minutes Projection */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Projected Minutes
          </span>
          <span className="font-mono text-foreground">
            {projectedStats.minMinutes?.toFixed(0) ?? 0} - {projectedStats.maxMinutes?.toFixed(0) ?? 0} min
          </span>
        </div>
        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="absolute h-full bg-primary/30 rounded-full"
            style={{ 
              left: `${((projectedStats.minMinutes ?? 0) / 48) * 100}%`,
              width: `${(((projectedStats.maxMinutes ?? 0) - (projectedStats.minMinutes ?? 0)) / 48) * 100}%`
            }}
          />
          <div 
            className="absolute h-full w-1 bg-primary rounded-full"
            style={{ left: `${(avgMinutes / 48) * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span className="text-primary font-mono">avg: {avgMinutes.toFixed(1)}</span>
          <span>48</span>
        </div>
      </div>

      {/* Rate Comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
            <Target className="h-3 w-3" />
            Required Rate
          </div>
          <div className="font-mono font-semibold text-sm text-foreground">
            {projection.requiredRate != null 
              ? `${projection.requiredRate.toFixed(2)}/min`
              : '— (no data)'}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-muted/30 border border-border/30">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
            <Activity className="h-3 w-3" />
            Historical Rate
          </div>
          <div className="font-mono font-semibold text-sm text-foreground">
            {projection.historicalRate != null 
              ? `${projection.historicalRate.toFixed(2)}/min`
              : '— (no data)'}
          </div>
          {projection.historicalRate == null && (
            <div className="text-[9px] text-muted-foreground mt-0.5">
              Historical data unavailable
            </div>
          )}
        </div>
      </div>

      {/* Efficiency Margin */}
      <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
        <span className="text-xs text-muted-foreground">Efficiency Margin</span>
        <Badge 
          variant="outline" 
          className={cn(
            "font-mono",
            efficiencyMargin >= 10 ? "text-emerald-400 border-emerald-500/30" :
            efficiencyMargin >= 0 ? "text-yellow-400 border-yellow-500/30" :
            "text-red-400 border-red-500/30"
          )}
        >
          {efficiencyMargin >= 0 ? '+' : ''}{efficiencyMargin.toFixed(1)}%
        </Badge>
      </div>

      {/* Recent Games Mini Chart */}
      {recentGames.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Recent Games</div>
          <div className="flex gap-1">
            {recentGames.map((game: any, idx: number) => {
              const value = game[statKey] || 0;
              const hit = value >= line;
              return (
                <div 
                  key={idx}
                  className={cn(
                    "flex-1 h-8 rounded flex items-center justify-center text-xs font-mono",
                    hit ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                  )}
                  title={`${game.opponent}: ${value}`}
                >
                  {hit ? '✓' : '✗'}
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground text-center">
            {recentGames.filter((g: any) => (g[statKey] || 0) >= line).length}/{recentGames.length} hit at line {line}
          </div>
        </div>
      )}
    </div>
  );
}
