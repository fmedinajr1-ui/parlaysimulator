import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Layers, FlaskConical, CheckCircle2, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BotParlay } from '@/hooks/useBotEngine';

interface TierBreakdownCardProps {
  parlays: BotParlay[];
}

const TIER_CONFIG = {
  exploration: { icon: FlaskConical, label: 'Explore', color: 'bg-blue-500', textColor: 'text-blue-400' },
  validation: { icon: CheckCircle2, label: 'Validate', color: 'bg-amber-500', textColor: 'text-amber-400' },
  execution: { icon: Rocket, label: 'Execute', color: 'bg-green-500', textColor: 'text-green-400' },
};

export function TierBreakdownCard({ parlays }: TierBreakdownCardProps) {
  const tierCounts = parlays.reduce((acc, parlay) => {
    const sn = (parlay.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const total = parlays.length;

  if (total === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Tier Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm">
            No parlays generated yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Tier Breakdown
          </CardTitle>
          <Badge variant="outline">{total} total</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Segmented bar */}
        <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
          {Object.entries(TIER_CONFIG).map(([tier, config]) => {
            const count = tierCounts[tier] || 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            if (pct === 0) return null;
            return (
              <div
                key={tier}
                className={cn('transition-all duration-300', config.color)}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between">
          {Object.entries(TIER_CONFIG).map(([tier, config]) => {
            const Icon = config.icon;
            const count = tierCounts[tier] || 0;
            return (
              <div key={tier} className="flex items-center gap-1.5 text-xs">
                <Icon className={cn('w-3.5 h-3.5', config.textColor)} />
                <span className="text-muted-foreground">{config.label}</span>
                <span className={cn('font-bold', config.textColor)}>{count}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
