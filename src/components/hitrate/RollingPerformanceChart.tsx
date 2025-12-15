import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { format, subDays } from 'date-fns';

interface PerformanceSnapshot {
  id: string;
  engine_name: string;
  sport: string | null;
  snapshot_date: string;
  window_days: number;
  hit_rate: number | null;
  brier_score: number | null;
  roi_percentage: number | null;
  sample_size: number | null;
  confidence_level: string | null;
}

interface RollingPerformanceChartProps {
  compact?: boolean;
}

export function RollingPerformanceChart({ compact = false }: RollingPerformanceChartProps) {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['performance-snapshots'],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('performance_snapshots')
        .select('*')
        .gte('snapshot_date', thirtyDaysAgo)
        .order('snapshot_date', { ascending: true });

      if (error) throw error;
      return data as PerformanceSnapshot[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Also fetch real-time stats using database function
  const { data: liveStats } = useQuery({
    queryKey: ['rolling-performance-live'],
    queryFn: async () => {
      const results: Record<number, any[]> = {};
      for (const days of [7, 14, 30]) {
        const { data, error } = await supabase.rpc('get_rolling_performance_stats', {
          p_window_days: days
        });
        if (!error && data) {
          results[days] = data;
        }
      }
      return results;
    },
    staleTime: 2 * 60 * 1000,
  });

  const chartData = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return { 7: [], 14: [], 30: [] };

    const grouped: Record<number, Record<string, any>> = { 7: {}, 14: {}, 30: {} };

    for (const snapshot of snapshots) {
      const key = snapshot.snapshot_date;
      if (!grouped[snapshot.window_days][key]) {
        grouped[snapshot.window_days][key] = {
          date: key,
          displayDate: format(new Date(key), 'MMM d'),
        };
      }
      grouped[snapshot.window_days][key][`${snapshot.engine_name}_hitRate`] = snapshot.hit_rate;
      grouped[snapshot.window_days][key][`${snapshot.engine_name}_roi`] = snapshot.roi_percentage;
      grouped[snapshot.window_days][key][`${snapshot.engine_name}_brier`] = snapshot.brier_score;
    }

    return {
      7: Object.values(grouped[7]),
      14: Object.values(grouped[14]),
      30: Object.values(grouped[30]),
    };
  }, [snapshots]);

  const getTrend = (current: number, previous: number) => {
    const diff = current - previous;
    if (Math.abs(diff) < 0.5) return { icon: Minus, color: 'text-muted-foreground', label: 'Stable' };
    if (diff > 0) return { icon: TrendingUp, color: 'text-green-500', label: `+${diff.toFixed(1)}%` };
    return { icon: TrendingDown, color: 'text-red-500', label: `${diff.toFixed(1)}%` };
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const hasHistoricalData = snapshots && snapshots.length > 0;
  const hasLiveData = liveStats && Object.values(liveStats).some(arr => arr.length > 0);

  if (!hasHistoricalData && !hasLiveData) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Activity className="h-5 w-5 text-primary" />
            Rolling Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <Activity className="h-12 w-12 mb-3 opacity-30" />
            <p>No performance data available yet</p>
            <p className="text-sm">Data will appear after bets are settled</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="border-border/50">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Rolling Performance</span>
            <Badge variant="outline" className="text-xs">Live</Badge>
          </div>
          {liveStats && liveStats[14]?.slice(0, 3).map((stat: any) => (
            <div key={stat.engine_name} className="flex justify-between items-center py-1 border-b border-border/30 last:border-0">
              <span className="text-xs text-muted-foreground capitalize">
                {stat.engine_name.replace('_', ' ')}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{stat.hit_rate?.toFixed(1)}%</span>
                <Badge 
                  variant={stat.roi_percentage > 0 ? 'default' : 'destructive'} 
                  className="text-xs px-1.5"
                >
                  {stat.roi_percentage > 0 ? '+' : ''}{stat.roi_percentage?.toFixed(1)}%
                </Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5 text-primary" />
          Rolling Performance Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="14" className="w-full">
          <TabsList className="grid grid-cols-3 w-full mb-4">
            <TabsTrigger value="7">7 Days</TabsTrigger>
            <TabsTrigger value="14">14 Days</TabsTrigger>
            <TabsTrigger value="30">30 Days</TabsTrigger>
          </TabsList>

          {[7, 14, 30].map((windowDays) => (
            <TabsContent key={windowDays} value={String(windowDays)} className="space-y-4">
              {/* Live Stats Summary */}
              {liveStats && liveStats[windowDays] && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  {liveStats[windowDays].map((stat: any) => (
                    <div 
                      key={stat.engine_name}
                      className="p-3 rounded-lg bg-muted/30 border border-border/30"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-sm font-medium capitalize">
                          {stat.engine_name.replace('_', ' ')}
                        </span>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            stat.sample_confidence === 'high' ? 'border-green-500/50 text-green-500' :
                            stat.sample_confidence === 'medium' ? 'border-yellow-500/50 text-yellow-500' :
                            'border-muted-foreground/50'
                          }`}
                        >
                          {stat.total_predictions} bets
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Hit Rate</span>
                          <p className="font-bold">{stat.hit_rate?.toFixed(1) || 0}%</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">ROI</span>
                          <p className={`font-bold ${stat.roi_percentage > 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {stat.roi_percentage > 0 ? '+' : ''}{stat.roi_percentage?.toFixed(1) || 0}%
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Historical Chart */}
              {chartData[windowDays as 7 | 14 | 30]?.length > 1 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData[windowDays as 7 | 14 | 30]}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis 
                        dataKey="displayDate" 
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                      />
                      <YAxis 
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        axisLine={{ stroke: 'hsl(var(--border))' }}
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="hitrate_parlays_hitRate" 
                        name="Hit Rate Parlays" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="juiced_props_hitRate" 
                        name="Juiced Props" 
                        stroke="hsl(142 76% 36%)" 
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="sharp_money_hitRate" 
                        name="Sharp Money" 
                        stroke="hsl(280 100% 70%)" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-dashed border-border/50 rounded-lg">
                  <Activity className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">Historical chart requires more data points</p>
                  <p className="text-xs">Check back tomorrow for trends</p>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
