import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Zap, Shield, Target } from 'lucide-react';
import { subDays } from 'date-fns';

interface PerformanceTrendCardProps {
  engineName?: string;
  compact?: boolean;
}

interface TrendData {
  current: number;
  previous: number;
  change: number;
  direction: 'up' | 'down' | 'stable';
  volatility: 'low' | 'medium' | 'high';
}

export function PerformanceTrendCard({ engineName, compact = false }: PerformanceTrendCardProps) {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['performance-trends', engineName],
    queryFn: async () => {
      const sixtyDaysAgo = subDays(new Date(), 60).toISOString().split('T')[0];
      
      let query = supabase
        .from('performance_snapshots')
        .select('*')
        .gte('snapshot_date', sixtyDaysAgo)
        .eq('window_days', 14)
        .order('snapshot_date', { ascending: true });

      if (engineName) {
        query = query.eq('engine_name', engineName);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const trends = useMemo(() => {
    if (!snapshots || snapshots.length < 2) return null;

    // Group by engine
    const byEngine: Record<string, typeof snapshots> = {};
    for (const s of snapshots) {
      if (!byEngine[s.engine_name]) byEngine[s.engine_name] = [];
      byEngine[s.engine_name].push(s);
    }

    const engineTrends: Record<string, TrendData> = {};

    for (const [engine, data] of Object.entries(byEngine)) {
      if (data.length < 2) continue;

      const hitRates = data.map(d => d.hit_rate || 0);
      const recent = hitRates.slice(-7);
      const older = hitRates.slice(-14, -7);

      const currentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const previousAvg = older.length > 0 
        ? older.reduce((a, b) => a + b, 0) / older.length 
        : currentAvg;

      const change = currentAvg - previousAvg;
      
      // Calculate volatility (standard deviation)
      const mean = hitRates.reduce((a, b) => a + b, 0) / hitRates.length;
      const variance = hitRates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / hitRates.length;
      const stdDev = Math.sqrt(variance);

      engineTrends[engine] = {
        current: currentAvg,
        previous: previousAvg,
        change,
        direction: Math.abs(change) < 1 ? 'stable' : change > 0 ? 'up' : 'down',
        volatility: stdDev < 5 ? 'low' : stdDev < 15 ? 'medium' : 'high'
      };
    }

    return engineTrends;
  }, [snapshots]);

  const getDirectionIcon = (direction: 'up' | 'down' | 'stable') => {
    switch (direction) {
      case 'up': return TrendingUp;
      case 'down': return TrendingDown;
      default: return Minus;
    }
  };

  const getDirectionColor = (direction: 'up' | 'down' | 'stable') => {
    switch (direction) {
      case 'up': return 'text-green-500';
      case 'down': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  };

  const getVolatilityBadge = (volatility: 'low' | 'medium' | 'high') => {
    switch (volatility) {
      case 'low':
        return <Badge variant="outline" className="gap-1 text-xs border-green-500/50 text-green-500"><Shield className="h-3 w-3" />Stable</Badge>;
      case 'medium':
        return <Badge variant="outline" className="gap-1 text-xs border-yellow-500/50 text-yellow-500"><Zap className="h-3 w-3" />Variable</Badge>;
      case 'high':
        return <Badge variant="outline" className="gap-1 text-xs border-red-500/50 text-red-500"><Zap className="h-3 w-3" />Volatile</Badge>;
    }
  };

  const formatEngineName = (name: string) => {
    return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!trends || Object.keys(trends).length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            Performance Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Trend data requires historical snapshots. Check back soon.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    const topEngine = Object.entries(trends).sort((a, b) => b[1].current - a[1].current)[0];
    if (!topEngine) return null;

    const [name, data] = topEngine;
    const Icon = getDirectionIcon(data.direction);

    return (
      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
        <Icon className={`h-4 w-4 ${getDirectionColor(data.direction)}`} />
        <span className="text-sm font-medium">{formatEngineName(name)}</span>
        <span className="text-sm">{data.current.toFixed(1)}%</span>
        <span className={`text-xs ${getDirectionColor(data.direction)}`}>
          {data.change > 0 ? '+' : ''}{data.change.toFixed(1)}%
        </span>
      </div>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Performance Trends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Object.entries(trends).map(([engine, data]) => {
          const Icon = getDirectionIcon(data.direction);
          
          return (
            <div 
              key={engine}
              className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border/30"
            >
              <div className="flex items-center gap-3">
                <div className={`p-1.5 rounded-full bg-background ${getDirectionColor(data.direction)}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{formatEngineName(engine)}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.current.toFixed(1)}% hit rate
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className={`text-sm font-medium ${getDirectionColor(data.direction)}`}>
                    {data.change > 0 ? '+' : ''}{data.change.toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">vs last week</p>
                </div>
                {getVolatilityBadge(data.volatility)}
              </div>
            </div>
          );
        })}

        {/* Sparkline placeholder - simplified visual */}
        <div className="pt-2 border-t border-border/30">
          <p className="text-xs text-muted-foreground mb-2">14-Day Trend</p>
          <div className="flex gap-0.5 h-8">
            {snapshots?.slice(-14).map((s, i) => {
              const height = Math.max(10, Math.min(100, (s.hit_rate || 50)));
              return (
                <div 
                  key={i}
                  className="flex-1 bg-primary/30 rounded-sm"
                  style={{ height: `${height}%` }}
                />
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
