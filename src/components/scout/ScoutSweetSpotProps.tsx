import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { FeedCard, FeedCardHeader } from '@/components/FeedCard';
import { Target, TrendingUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScoutSweetSpotPropsProps {
  homeTeam: string;
  awayTeam: string;
}

function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const PROP_LABELS: Record<string, { label: string; short: string }> = {
  points: { label: 'Points', short: 'PTS' },
  assists: { label: 'Assists', short: 'AST' },
  threes: { label: '3-Pointers', short: '3PT' },
  rebounds: { label: 'Rebounds', short: 'REB' },
  blocks: { label: 'Blocks', short: 'BLK' },
  steals: { label: 'Steals', short: 'STL' },
};

function hitRateColor(rate: number): string {
  if (rate >= 0.9) return 'text-emerald-400';
  if (rate >= 0.75) return 'text-green-400';
  if (rate >= 0.6) return 'text-chart-3';
  return 'text-muted-foreground';
}

function hitRateBg(rate: number): string {
  if (rate >= 0.9) return 'bg-emerald-500/15 border-emerald-500/30';
  if (rate >= 0.75) return 'bg-green-500/15 border-green-500/30';
  if (rate >= 0.6) return 'bg-chart-3/15 border-chart-3/30';
  return 'bg-muted/50 border-border/50';
}

export function ScoutSweetSpotProps({ homeTeam, awayTeam }: ScoutSweetSpotPropsProps) {
  const today = getEasternDate();

  const { data: picks, isLoading } = useQuery({
    queryKey: ['scout-sweet-spot-props', homeTeam, awayTeam, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('is_active', true)
        .order('l10_hit_rate', { ascending: false });

      if (error) throw error;
      // Filter out fake lines (e.g. 0.5 for 3PT)
      return (data ?? []).filter(
        pick => pick.recommended_line == null || pick.recommended_line >= 1.5
      );
    },
    staleTime: 60_000,
  });

  // Filter to players we can loosely match to either team via game description or player context
  // Since category_sweet_spots doesn't have a team column, we show all today's picks
  // A future enhancement could cross-reference with rosters

  if (isLoading) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Sweet Spot Props" icon={<Target className="w-5 h-5" />} />
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </FeedCard>
    );
  }

  if (!picks || picks.length === 0) {
    return (
      <FeedCard variant="glass">
        <FeedCardHeader title="Sweet Spot Props" icon={<Target className="w-5 h-5" />} />
        <p className="text-sm text-muted-foreground text-center py-6">
          No sweet spot picks available for today's games yet.
        </p>
      </FeedCard>
    );
  }

  return (
    <FeedCard variant="glass">
      <FeedCardHeader
        title="Sweet Spot Props"
        subtitle={`${picks.length} picks today`}
        icon={<Target className="w-5 h-5" />}
      />
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {picks.map((pick) => {
          const hitRate = pick.l10_hit_rate ?? 0;
          const propInfo = PROP_LABELS[pick.prop_type] ?? { label: pick.prop_type, short: pick.prop_type.toUpperCase() };
          const edge = pick.projected_value && pick.recommended_line
            ? pick.projected_value - pick.recommended_line
            : null;

          return (
            <div
              key={pick.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                hitRateBg(hitRate)
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-sm text-foreground truncate">
                  {pick.player_name}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                  {propInfo.short}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs">
                {/* Line + Side */}
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Line:</span>
                  <span className="font-medium text-foreground">
                    {pick.recommended_line ?? '—'}
                  </span>
                  {pick.recommended_side && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] px-1 py-0 ml-0.5',
                        pick.recommended_side === 'OVER'
                          ? 'text-emerald-400 border-emerald-500/30'
                          : 'text-orange-400 border-orange-500/30'
                      )}
                    >
                      {pick.recommended_side}
                    </Badge>
                  )}
                </div>

                {/* L10 Hit Rate */}
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">L10:</span>
                  <span className={cn('font-bold', hitRateColor(hitRate))}>
                    {(hitRate * 100).toFixed(0)}%
                  </span>
                </div>

                {/* Projected + Edge */}
                {pick.projected_value != null && (
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-muted-foreground" />
                    <span className="text-foreground font-medium">
                      {pick.projected_value.toFixed(1)}
                    </span>
                    {edge !== null && (
                      <span
                        className={cn(
                          'text-[10px] font-bold',
                          edge > 0 ? 'text-emerald-400' : edge < -1 ? 'text-destructive' : 'text-muted-foreground'
                        )}
                      >
                        ({edge > 0 ? '+' : ''}{edge.toFixed(1)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </FeedCard>
  );
}
