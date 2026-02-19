import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { BarChart3, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRiskMode } from '@/contexts/RiskModeContext';

interface PickConfidence {
  playerName: string;
  propType: string;
  line: number;
  currentValue: number;
  side?: string;
}

interface CustomerConfidenceDashboardProps {
  picks: PickConfidence[];
}

function heatColor(pct: number, mode: string): string {
  // Adjust thresholds based on risk mode
  const greenThresh = mode === 'aggressive' ? 60 : mode === 'conservative' ? 80 : 70;
  const yellowThresh = mode === 'aggressive' ? 30 : mode === 'conservative' ? 50 : 40;

  if (pct >= greenThresh) return 'bg-emerald-500';
  if (pct >= yellowThresh) return 'bg-chart-3';
  return 'bg-destructive';
}

function heatText(pct: number, mode: string): string {
  const greenThresh = mode === 'aggressive' ? 60 : mode === 'conservative' ? 80 : 70;
  const yellowThresh = mode === 'aggressive' ? 30 : mode === 'conservative' ? 50 : 40;

  if (pct >= greenThresh) return 'text-emerald-400';
  if (pct >= yellowThresh) return 'text-chart-3';
  return 'text-destructive';
}

export function CustomerConfidenceDashboard({ picks }: CustomerConfidenceDashboardProps) {
  const { riskMode } = useRiskMode();

  if (picks.length === 0) return null;

  // Calculate heat for each pick (pace % toward line)
  const pickHeats = picks.map((p) => {
    // For "OVER" picks, pace = currentValue / line
    // For "UNDER" picks, pace = (line - currentValue) / line (staying under is good)
    const isOver = p.side?.toUpperCase() !== 'UNDER';
    const pct = isOver
      ? Math.min(100, (p.currentValue / Math.max(p.line, 0.1)) * 100)
      : Math.min(100, Math.max(0, ((p.line - p.currentValue) / Math.max(p.line, 0.1)) * 100));
    return { ...p, heatPct: Math.round(pct) };
  });

  // Simple survival estimate: average of individual heat percentages
  const avgHeat = pickHeats.reduce((sum, p) => sum + p.heatPct, 0) / pickHeats.length;
  const survivalPct = Math.round(Math.min(99, Math.max(1, avgHeat * 0.9)));

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Confidence Dashboard</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <span className={cn('text-sm font-bold', heatText(survivalPct, riskMode))}>
              {survivalPct}% survival
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          {pickHeats.map((pick, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-medium truncate">{pick.playerName}</span>
                <span className={cn('font-bold', heatText(pick.heatPct, riskMode))}>
                  {pick.heatPct}%
                </span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', heatColor(pick.heatPct, riskMode))}
                  style={{ width: `${pick.heatPct}%` }}
                />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{pick.currentValue} of {pick.line} {pick.propType}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
