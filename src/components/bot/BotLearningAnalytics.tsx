/**
 * BotLearningAnalytics.tsx
 * 
 * Displays learning velocity, tier performance, and statistical confidence metrics.
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

export function BotLearningAnalytics() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['bot-learning-metrics'],
    queryFn: async () => {
      // Get all parlays - tier column may exist or not depending on migration status
      const { data: parlaysRaw } = await supabase
        .from('bot_daily_parlays')
        .select('*');

      // Safely extract tier and outcome from parlays
      const parlays = (parlaysRaw || []).map((p: any) => ({
        tier: p.tier || 'execution', // Default to execution if tier not set
        outcome: p.outcome,
        profit_loss: p.profit_loss,
        created_at: p.created_at,
      }));

      // Calculate tier-level metrics
      const tierStats: Record<string, TierMetrics> = {};
      
      for (const tier of ['exploration', 'validation', 'execution'] as const) {
        const tierParlays = parlays.filter(p => p.tier === tier);
        const settled = tierParlays.filter(p => p.outcome && p.outcome !== 'pending');
        const wins = settled.filter(p => p.outcome === 'won').length;
        const losses = settled.filter(p => p.outcome === 'lost').length;
        
        const totalSettled = settled.length;
        const winRate = totalSettled > 0 ? (wins / totalSettled) * 100 : 0;
        const targetSamples = TIER_TARGETS[tier].minSamples;
        const sampleSufficiency = Math.min(100, (totalSettled / targetSamples) * 100);
        
        // Wilson score interval for confidence
        const z = 1.96; // 95% CI
        const n = totalSettled || 1;
        const p = wins / n;
        const denominator = 1 + z * z / n;
        const center = p + z * z / (2 * n);
        const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
        
        const lower = Math.max(0, (center - spread) / denominator) * 100;
        const upper = Math.min(1, (center + spread) / denominator) * 100;
        
        // Estimate days to convergence
        const dailyRate = tierParlays.length / 7; // Assuming 7 days of data
        const remainingSamples = Math.max(0, targetSamples - totalSettled);
        const daysToConvergence = dailyRate > 0 ? Math.ceil(remainingSamples / dailyRate) : 999;
        
        tierStats[tier] = {
          tier,
          totalGenerated: tierParlays.length,
          totalSettled,
          wins,
          losses,
          winRate,
          sampleSufficiency,
          confidenceInterval: { lower, upper },
          daysToConvergence,
        };
      }

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
