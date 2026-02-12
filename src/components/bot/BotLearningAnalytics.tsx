/**
 * BotLearningAnalytics.tsx
 * 
 * Displays learning velocity, tier performance, and statistical confidence metrics.
 * Reads from bot_learning_metrics table for pre-computed snapshots.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Brain, TrendingUp, Target, Zap, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TierMetrics {
  tier: string;
  totalGenerated: number;
  totalSettled: number;
  wins: number;
  losses: number;
  winRate: number;
  sampleSufficiency: number;
  confidenceInterval: { lower: number; upper: number };
  daysToConvergence: number;
}

const TIER_TARGETS = {
  exploration: { minSamples: 500, label: 'Exploration', colorClass: 'bg-primary/70' },
  validation: { minSamples: 300, label: 'Validation', colorClass: 'bg-secondary' },
  execution: { minSamples: 300, label: 'Execution', colorClass: 'bg-accent' },
};

function computeTierFromParlays(parlays: any[]): Record<string, TierMetrics> {
  const tierStats: Record<string, TierMetrics> = {};
  for (const tier of ['exploration', 'validation', 'execution'] as const) {
    const tierParlays = parlays.filter(p => (p.tier || 'execution') === tier);
    const settled = tierParlays.filter(p => p.outcome && p.outcome !== 'pending');
    const wins = settled.filter(p => p.outcome === 'won').length;
    const losses = settled.filter(p => p.outcome === 'lost').length;
    const totalSettled = settled.length;
    const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;
    const targetSamples = TIER_TARGETS[tier].minSamples;
    const sampleSufficiency = Math.min(100, (totalSettled / targetSamples) * 100);

    const z = 1.96;
    const n = totalSettled || 1;
    const p = wins / n;
    const denominator = 1 + z * z / n;
    const center = p + z * z / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    const lower = Math.max(0, (center - spread) / denominator) * 100;
    const upper = Math.min(1, (center + spread) / denominator) * 100;

    const dailyRate = tierParlays.length / 7;
    const remainingSamples = Math.max(0, targetSamples - totalSettled);
    const daysToConvergence = dailyRate > 0 ? Math.ceil(remainingSamples / dailyRate) : 999;

    tierStats[tier] = {
      tier, totalGenerated: tierParlays.length, totalSettled, wins, losses,
      winRate, sampleSufficiency, confidenceInterval: { lower, upper }, daysToConvergence,
    };
  }
  return tierStats;
}

export function BotLearningAnalytics() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['bot-learning-metrics'],
    queryFn: async () => {
      // Try reading from bot_learning_metrics first
      const { data: snapshots } = await supabase
        .from('bot_learning_metrics')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(3);

      if (snapshots && snapshots.length > 0) {
        // Get the latest date's snapshots
        const latestDate = (snapshots as any[])[0].snapshot_date;
        const latest = (snapshots as any[]).filter((s: any) => s.snapshot_date === latestDate);

        const tierStats: Record<string, TierMetrics> = {};
        let totalParlays = 0;
        let totalSettled = 0;

        for (const tier of ['exploration', 'validation', 'execution'] as const) {
          const snap = latest.find((s: any) => s.tier === tier);
          if (snap) {
            tierStats[tier] = {
              tier,
              totalGenerated: snap.total_generated,
              totalSettled: snap.total_settled,
              wins: snap.wins,
              losses: snap.losses,
              winRate: snap.total_settled > 0 ? (snap.wins / snap.total_settled) * 100 : 0,
              sampleSufficiency: snap.sample_sufficiency,
              confidenceInterval: { lower: snap.ci_lower, upper: snap.ci_upper },
              daysToConvergence: snap.days_to_convergence,
            };
            totalParlays += snap.total_generated;
            totalSettled += snap.total_settled;
          } else {
            tierStats[tier] = {
              tier, totalGenerated: 0, totalSettled: 0, wins: 0, losses: 0,
              winRate: 0, sampleSufficiency: 0, confidenceInterval: { lower: 0, upper: 100 },
              daysToConvergence: 999,
            };
          }
        }

        return { tierStats, totalParlays, totalSettled };
      }

      // Fallback: compute from parlays
      const { data: parlaysRaw } = await supabase
        .from('bot_daily_parlays')
        .select('tier, outcome, profit_loss, created_at');

      const parlays = (parlaysRaw || []).map((p: any) => ({
        tier: p.tier || 'execution',
        outcome: p.outcome,
      }));

      const tierStats = computeTierFromParlays(parlays);
      return {
        tierStats,
        totalParlays: parlays.length,
        totalSettled: parlays.filter(p => p.outcome && p.outcome !== 'pending').length,
      };
    },
    refetchInterval: 60000,
  });

  if (isLoading || !metrics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Learning Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-20 bg-muted rounded" />
            <div className="h-20 bg-muted rounded" />
            <div className="h-20 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallSufficiency = Object.values(metrics.tierStats).reduce(
    (sum, t) => sum + t.sampleSufficiency, 0
  ) / 3;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Learning Analytics
          </CardTitle>
          <Badge variant={overallSufficiency >= 80 ? 'default' : 'secondary'}>
            {overallSufficiency.toFixed(0)}% Confident
          </Badge>
        </div>
        <CardDescription>
          Statistical confidence progress across tiers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Progress */}
        <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Learning Velocity
            </span>
            <span className="text-sm text-muted-foreground">
              {metrics.totalSettled} total samples
            </span>
          </div>
          <Progress value={overallSufficiency} className="h-3" />
          <p className="text-xs text-muted-foreground mt-2">
            {overallSufficiency >= 95 
              ? '✓ Statistically significant - ready for optimization'
              : `~${Math.max(...Object.values(metrics.tierStats).map(t => t.daysToConvergence))} days to 95% confidence`
            }
          </p>
        </div>

        {/* Tier Breakdown */}
        <div className="space-y-4">
          {(['exploration', 'validation', 'execution'] as const).map((tier) => {
            const stats = metrics.tierStats[tier];
            const config = TIER_TARGETS[tier];
            
            return (
              <div key={tier} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full', config.colorClass)} />
                    <span className="text-sm font-medium">{config.label} Tier</span>
                    <Badge variant="outline" className="text-xs">
                      {stats.totalGenerated}/day target
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {stats.totalSettled > 0 && (
                      <span className={cn(
                        'text-sm font-medium',
                        stats.winRate >= 50 ? 'text-primary' : 'text-muted-foreground'
                      )}>
                        {stats.winRate.toFixed(1)}% WR
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ({stats.wins}W/{stats.losses}L)
                    </span>
                  </div>
                </div>
                
                <Progress 
                  value={stats.sampleSufficiency} 
                  className="h-2"
                />
                
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {stats.totalSettled} / {config.minSamples} samples
                  </span>
                  <span>
                    CI: [{stats.confidenceInterval.lower.toFixed(0)}% - {stats.confidenceInterval.upper.toFixed(0)}%]
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <BarChart3 className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{metrics.totalParlays}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <Target className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">{metrics.totalSettled}</p>
            <p className="text-xs text-muted-foreground">Settled</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-muted/50">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-lg font-bold">
              {metrics.totalSettled > 0 
                ? `${(Object.values(metrics.tierStats).reduce((sum, t) => sum + t.wins, 0) / metrics.totalSettled * 100).toFixed(0)}%`
                : '—'
              }
            </p>
            <p className="text-xs text-muted-foreground">Overall WR</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
