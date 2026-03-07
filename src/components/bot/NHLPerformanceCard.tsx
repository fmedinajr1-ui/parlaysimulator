import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Target, Trophy, DollarSign } from 'lucide-react';

const NHL_STRATEGIES = ['nhl_floor_lock', 'nhl_optimal_combo', 'nhl_ceiling_shot'];

interface StrategyStats {
  name: string;
  wins: number;
  losses: number;
  pending: number;
  pnl: number;
  avgOdds: number;
}

function useNHLPerformance(range: 'week' | 'month' | 'all') {
  return useQuery({
    queryKey: ['nhl-performance', range],
    queryFn: async () => {
      let query = supabase
        .from('bot_daily_parlays')
        .select('strategy_name, outcome, profit_loss, expected_odds, parlay_date')
        .in('strategy_name', NHL_STRATEGIES);

      if (range === 'week') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        query = query.gte('parlay_date', d.toISOString().split('T')[0]);
      } else if (range === 'month') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        query = query.gte('parlay_date', d.toISOString().split('T')[0]);
      }

      const { data, error } = await query.order('parlay_date', { ascending: false });
      if (error) { console.error(error); return null; }

      const byStrategy: Record<string, StrategyStats> = {};
      let totalWins = 0, totalLosses = 0, totalPnl = 0, totalPending = 0;

      for (const row of data || []) {
        const s = row.strategy_name;
        if (!byStrategy[s]) {
          byStrategy[s] = { name: s, wins: 0, losses: 0, pending: 0, pnl: 0, avgOdds: 0 };
        }
        const st = byStrategy[s];
        if (row.outcome === 'won') { st.wins++; totalWins++; }
        else if (row.outcome === 'lost') { st.losses++; totalLosses++; }
        else { st.pending++; totalPending++; }
        st.pnl += row.profit_loss || 0;
        totalPnl += row.profit_loss || 0;
        st.avgOdds += row.expected_odds || 0;
      }

      // Compute averages
      for (const st of Object.values(byStrategy)) {
        const total = st.wins + st.losses + st.pending;
        st.avgOdds = total > 0 ? st.avgOdds / total : 0;
      }

      const totalSettled = totalWins + totalLosses;
      return {
        strategies: Object.values(byStrategy),
        totalWins,
        totalLosses,
        totalPending,
        totalPnl,
        winRate: totalSettled > 0 ? totalWins / totalSettled : 0,
        totalParlays: (data || []).length,
      };
    },
    staleTime: 60000,
  });
}

const STRATEGY_LABELS: Record<string, { label: string; icon: string }> = {
  nhl_floor_lock: { label: 'Floor Lock', icon: '🔒' },
  nhl_optimal_combo: { label: 'Optimal Combo', icon: '🎯' },
  nhl_ceiling_shot: { label: 'Ceiling Shot', icon: '🚀' },
};

export function NHLPerformanceCard() {
  const [range, setRange] = React.useState<'week' | 'month' | 'all'>('week');
  const { data, isLoading } = useNHLPerformance(range);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">🏒 NHL Performance</CardTitle>
        </CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">Loading...</p></CardContent>
      </Card>
    );
  }

  if (!data || data.totalParlays === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">🏒 NHL Performance</CardTitle>
        </CardHeader>
        <CardContent><p className="text-xs text-muted-foreground">No NHL parlays found for this period.</p></CardContent>
      </Card>
    );
  }

  const pnlColor = data.totalPnl >= 0 ? 'text-neon-green' : 'text-neon-red';
  const wrColor = data.winRate >= 0.5 ? 'text-neon-green' : data.winRate >= 0.35 ? 'text-neon-yellow' : 'text-neon-red';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">🏒 NHL-Only Performance</CardTitle>
          <div className="flex gap-1">
            {(['week', 'month', 'all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                  range === r
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                )}
              >
                {r === 'week' ? '7D' : r === 'month' ? '30D' : 'All'}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Overall Summary */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <p className={cn('text-lg font-bold', wrColor)}>
              {(data.winRate * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">
              {data.totalWins}-{data.totalLosses}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">Record</p>
          </div>
          <div>
            <p className={cn('text-lg font-bold', pnlColor)}>
              {data.totalPnl >= 0 ? '+' : ''}${data.totalPnl.toFixed(0)}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase">P&L</p>
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{data.totalPending}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Pending</p>
          </div>
        </div>

        {/* Per-Strategy Breakdown */}
        <div className="space-y-1.5">
          {data.strategies.map(st => {
            const settled = st.wins + st.losses;
            const wr = settled > 0 ? st.wins / settled : 0;
            const meta = STRATEGY_LABELS[st.name] || { label: st.name, icon: '📊' };
            return (
              <div key={st.name} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{meta.icon}</span>
                  <span className="text-xs font-medium">{meta.label}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">{st.wins}W-{st.losses}L</span>
                  <Badge variant="outline" className={cn('text-[10px]', wr >= 0.5 ? 'border-neon-green/40 text-neon-green' : 'border-neon-red/40 text-neon-red')}>
                    {(wr * 100).toFixed(0)}%
                  </Badge>
                  <span className={cn('font-medium', st.pnl >= 0 ? 'text-neon-green' : 'text-neon-red')}>
                    {st.pnl >= 0 ? '+' : ''}${st.pnl.toFixed(0)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
