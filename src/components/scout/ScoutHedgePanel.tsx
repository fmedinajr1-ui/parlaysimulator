import React from 'react';
import { useDeepSweetSpots } from '@/hooks/useDeepSweetSpots';
import { useSweetSpotLiveData } from '@/hooks/useSweetSpotLiveData';
import { HedgeRecommendation } from '@/components/sweetspots/HedgeRecommendation';
import { FeedCard, FeedCardHeader } from '@/components/FeedCard';
import { Shield, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HedgeStatus } from '@/types/sweetSpot';

interface ScoutHedgePanelProps {
  homeTeam: string;
  awayTeam: string;
}

const STATUS_LABELS: Record<HedgeStatus, { label: string; className: string }> = {
  on_track: { label: 'ON TRACK', className: 'bg-chart-2/15 text-chart-2 border-chart-2/30' },
  monitor: { label: 'MONITOR', className: 'bg-chart-3/15 text-chart-3 border-chart-3/30' },
  alert: { label: 'ALERT', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  urgent: { label: 'URGENT', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  profit_lock: { label: 'PROFIT LOCK', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

export function ScoutHedgePanel({ homeTeam, awayTeam }: ScoutHedgePanelProps) {
  const { data, isLoading: spotsLoading } = useDeepSweetSpots();
  const rawSpots = data?.spots ?? [];
  const { spots: enrichedSpots, isLoading: liveLoading } = useSweetSpotLiveData(rawSpots);

  const isLoading = spotsLoading || liveLoading;

  // Filter to spots with live hedge data
  const hedgeSpots = enrichedSpots.filter((s) => {
    if (!s.liveData?.hedgeStatus) return false;
    return true; // Show all live hedge spots; can filter by team if teamName available
  });

  if (isLoading) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Hedge Recommendations" icon={<Shield className="w-5 h-5" />} />
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </FeedCard>
    );
  }

  if (hedgeSpots.length === 0) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Hedge Recommendations" icon={<Shield className="w-5 h-5" />} />
        <p className="text-sm text-muted-foreground text-center py-6">
          No live hedge data yet. Recommendations appear once games are in progress.
        </p>
      </FeedCard>
    );
  }

  // Summary counts
  const statusCounts = hedgeSpots.reduce<Partial<Record<HedgeStatus, number>>>((acc, s) => {
    const st = s.liveData!.hedgeStatus!;
    acc[st] = (acc[st] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <FeedCard variant="glass">
      <FeedCardHeader
        title="Hedge Recommendations"
        subtitle={`${hedgeSpots.length} active`}
        icon={<Shield className="w-5 h-5" />}
        action={
          <div className="flex gap-1 flex-wrap">
            {(Object.entries(statusCounts) as [HedgeStatus, number][]).map(([status, count]) => {
              const info = STATUS_LABELS[status];
              return (
                <Badge
                  key={status}
                  variant="outline"
                  className={cn('text-[10px] px-1.5 py-0', info.className)}
                >
                  {count} {info.label}
                </Badge>
              );
            })}
          </div>
        }
      />
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {hedgeSpots.map((spot) => (
          <div key={spot.id} className="rounded-lg border border-border/40 bg-card/50 p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-foreground truncate">
                {spot.playerName}
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {spot.side?.toUpperCase()} {spot.line}
              </Badge>
            </div>
            <HedgeRecommendation spot={spot} />
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
