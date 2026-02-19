import React from 'react';
import { useDeepSweetSpots } from '@/hooks/useDeepSweetSpots';
import { useSweetSpotLiveData } from '@/hooks/useSweetSpotLiveData';
import { CustomerHedgeIndicator, mapToCustomerTier, type CustomerTier } from './CustomerHedgeIndicator';
import { FeedCard, FeedCardHeader } from '@/components/FeedCard';
import { Shield, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CustomerHedgePanelProps {
  homeTeam: string;
  awayTeam: string;
}

const TIER_LABELS: Record<CustomerTier, { label: string; className: string }> = {
  on_track: { label: 'ON TRACK', className: 'bg-chart-2/15 text-chart-2 border-chart-2/30' },
  caution: { label: 'CAUTION', className: 'bg-chart-3/15 text-chart-3 border-chart-3/30' },
  action_needed: { label: 'ACTION NEEDED', className: 'bg-destructive/15 text-destructive border-destructive/30' },
};

export function CustomerHedgePanel({ homeTeam, awayTeam }: CustomerHedgePanelProps) {
  const { data, isLoading: spotsLoading } = useDeepSweetSpots();
  const rawSpots = data?.spots ?? [];
  const { spots: enrichedSpots, isLoading: liveLoading } = useSweetSpotLiveData(rawSpots);

  const isLoading = spotsLoading || liveLoading;

  const hedgeSpots = enrichedSpots.filter((s) => !!s.liveData?.hedgeStatus);

  if (isLoading) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Pick Status" icon={<Shield className="w-5 h-5" />} />
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </FeedCard>
    );
  }

  if (hedgeSpots.length === 0) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Pick Status" icon={<Shield className="w-5 h-5" />} />
        <p className="text-sm text-muted-foreground text-center py-6">
          No live pick data yet. Status updates appear once games are in progress.
        </p>
      </FeedCard>
    );
  }

  const tierCounts = hedgeSpots.reduce<Partial<Record<CustomerTier, number>>>((acc, s) => {
    const tier = mapToCustomerTier(s.liveData!.hedgeStatus!);
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <FeedCard variant="glass">
      <FeedCardHeader
        title="Pick Status"
        subtitle={`${hedgeSpots.length} active`}
        icon={<Shield className="w-5 h-5" />}
        action={
          <div className="flex gap-1 flex-wrap">
            {(Object.entries(tierCounts) as [CustomerTier, number][]).map(([tier, count]) => {
              const info = TIER_LABELS[tier];
              return (
                <Badge key={tier} variant="outline" className={cn('text-[10px] px-1.5 py-0', info.className)}>
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
            <CustomerHedgeIndicator spot={spot} />
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
