import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SystemAccuracy } from "@/hooks/useUnifiedAccuracy";

interface SystemAccuracyCardProps {
  system: SystemAccuracy;
}

const SYSTEM_COLORS: Record<string, string> = {
  '3pt_shooters': 'text-orange-400',
  'whale_proxy': 'text-blue-400',
  'sweet_spots': 'text-purple-400',
  'lock_mode': 'text-emerald-400',
};

const CONFIDENCE_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  high: { label: 'High Confidence', variant: 'default' },
  medium: { label: 'Medium Confidence', variant: 'secondary' },
  low: { label: 'Low Confidence', variant: 'outline' },
  insufficient: { label: 'Needs Data', variant: 'destructive' },
};

export function SystemAccuracyCard({ system }: SystemAccuracyCardProps) {
  const colorClass = SYSTEM_COLORS[system.systemName] || 'text-muted-foreground';
  const confidenceInfo = CONFIDENCE_BADGES[system.sampleConfidence] || CONFIDENCE_BADGES.insufficient;
  
  // Calculate progress with 52.4% breakeven marker
  const hitRateProgress = Math.min(100, Math.max(0, system.hitRate));
  const breakevenPosition = 52.4;
  
  // Color based on performance vs breakeven
  const getHitRateColor = () => {
    if (system.hitRate >= 55) return 'text-green-400';
    if (system.hitRate >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn("text-2xl", colorClass)}>{system.icon}</span>
          <div>
            <h3 className="font-semibold text-sm">{system.displayName}</h3>
            <Badge variant={confidenceInfo.variant} className="text-xs mt-1">
              {confidenceInfo.label}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-bold", system.gradeColor)}>
            {system.grade}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {/* Hit Rate */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-muted-foreground">Hit Rate</span>
            <span className={cn("text-lg font-bold", getHitRateColor())}>
              {system.verifiedPicks > 0 ? `${system.hitRate}%` : '--'}
            </span>
          </div>
          <div className="relative">
            <Progress 
              value={hitRateProgress} 
              className="h-2"
            />
            {/* Breakeven marker */}
            <div 
              className="absolute top-0 h-2 w-0.5 bg-yellow-500/80"
              style={{ left: `${breakevenPosition}%` }}
              title="52.4% Breakeven"
            />
          </div>
        </div>

        {/* W-L-P Record */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Record</span>
          <div className="flex items-center gap-2">
            <span className="text-green-400">{system.hits}W</span>
            <span className="text-muted-foreground">-</span>
            <span className="text-red-400">{system.misses}L</span>
            {system.pushes > 0 && (
              <>
                <span className="text-muted-foreground">-</span>
                <span className="text-yellow-400">{system.pushes}P</span>
              </>
            )}
          </div>
        </div>

        {/* Sample Size */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{system.verifiedPicks} verified / {system.totalPicks} total</span>
          {system.lastUpdated && (
            <span>Updated {formatRelativeTime(system.lastUpdated)}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  return 'just now';
}
