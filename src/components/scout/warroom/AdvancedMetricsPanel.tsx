import React, { useState } from 'react';
import { ChevronDown, Brain } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { RegressionAlert } from '@/hooks/useRegressionDetection';

interface AdvancedMetricsPanelProps {
  blowoutRiskPct: number; // 0-100
  fatigueImpactPct: number; // 0-100
  regressionAlerts: RegressionAlert[];
  monteCarloWinPct?: number; // 0-100
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-bold tabular-nums', color)}>
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[hsl(var(--warroom-card-border))] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(value, 100)}%`,
            background: `hsl(var(${color.includes('green') ? '--warroom-green' : color.includes('gold') ? '--warroom-gold' : color.includes('ice') ? '--warroom-ice' : '--warroom-danger'}))`,
          }}
        />
      </div>
    </div>
  );
}

export function AdvancedMetricsPanel({
  blowoutRiskPct,
  fatigueImpactPct,
  regressionAlerts,
  monteCarloWinPct = 50,
}: AdvancedMetricsPanelProps) {
  const [open, setOpen] = useState(false);

  const avgRegressionProb = regressionAlerts.length > 0
    ? (regressionAlerts.reduce((s, a) => s + a.probability, 0) / regressionAlerts.length) * 100
    : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="warroom-card w-full p-3 flex items-center justify-between hover:bg-[hsl(var(--warroom-card-border)/0.3)] transition-colors">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-[hsl(var(--warroom-ice))]" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Advanced Metrics
          </span>
        </div>
        <ChevronDown className={cn(
          'w-4 h-4 text-muted-foreground transition-transform',
          open && 'rotate-180'
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="warroom-card mt-1 p-3 space-y-3">
          <MetricBar
            label="Monte Carlo Win %"
            value={monteCarloWinPct}
            color={monteCarloWinPct > 55 ? 'text-[hsl(var(--warroom-green))]' : 'text-muted-foreground'}
          />
          <MetricBar
            label="Blowout Risk"
            value={blowoutRiskPct}
            color={blowoutRiskPct > 40 ? 'text-[hsl(var(--warroom-danger))]' : 'text-[hsl(var(--warroom-gold))]'}
          />
          <MetricBar
            label="Fatigue Impact"
            value={fatigueImpactPct}
            color={fatigueImpactPct > 50 ? 'text-[hsl(var(--warroom-danger))]' : 'text-[hsl(var(--warroom-green))]'}
          />
          <MetricBar
            label="Regression Probability"
            value={avgRegressionProb}
            color={avgRegressionProb > 50 ? 'text-[hsl(var(--warroom-ice))]' : 'text-muted-foreground'}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
