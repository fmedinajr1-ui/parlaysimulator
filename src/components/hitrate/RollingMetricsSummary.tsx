import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Target, DollarSign, Activity } from 'lucide-react';
import { getCalibrationGrade } from '@/lib/calibration-engine';

interface RollingMetricsSummaryProps {
  compact?: boolean;
}

export function RollingMetricsSummary({ compact = false }: RollingMetricsSummaryProps) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['rolling-metrics-summary'],
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

  const aggregateStats = (windowStats: any[]) => {
    if (!windowStats || windowStats.length === 0) return null;
    
    const totalPredictions = windowStats.reduce((sum, s) => sum + (s.total_predictions || 0), 0);
    const correctPredictions = windowStats.reduce((sum, s) => sum + (s.correct_predictions || 0), 0);
    const avgHitRate = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;
    const avgRoi = windowStats.reduce((sum, s) => sum + (s.roi_percentage || 0), 0) / windowStats.length;
    
    return {
      totalPredictions,
      correctPredictions,
      hitRate: avgHitRate,
      roi: avgRoi
    };
  };

  const getTrendIcon = (current: number, baseline: number = 50) => {
    const diff = current - baseline;
    if (Math.abs(diff) < 2) return { Icon: Minus, color: 'text-muted-foreground' };
    if (diff > 0) return { Icon: TrendingUp, color: 'text-green-500' };
    return { Icon: TrendingDown, color: 'text-red-500' };
  };

  if (isLoading) {
    return (
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
    );
  }

  if (!stats || Object.keys(stats).length === 0) {
    return null;
  }

  const stats7 = aggregateStats(stats[7] || []);
  const stats14 = aggregateStats(stats[14] || []);
  const stats30 = aggregateStats(stats[30] || []);

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {stats14 && (
          <>
            <Badge variant="outline" className="gap-1.5">
              <Target className="h-3 w-3" />
              <span>{stats14.hitRate.toFixed(1)}%</span>
              {getTrendIcon(stats14.hitRate).Icon && (
                <span className={getTrendIcon(stats14.hitRate).color}>
                  {React.createElement(getTrendIcon(stats14.hitRate).Icon, { className: 'h-3 w-3' })}
                </span>
              )}
            </Badge>
            <Badge 
              variant={stats14.roi > 0 ? 'default' : 'destructive'}
              className="gap-1.5"
            >
              <DollarSign className="h-3 w-3" />
              <span>{stats14.roi > 0 ? '+' : ''}{stats14.roi.toFixed(1)}% ROI</span>
            </Badge>
            <Badge variant="secondary" className="gap-1.5">
              <Activity className="h-3 w-3" />
              <span>{stats14.totalPredictions} bets</span>
            </Badge>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* 7-Day Summary */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">7 Days</span>
          {stats7 && (
            <span className={getTrendIcon(stats7.hitRate).color}>
              {React.createElement(getTrendIcon(stats7.hitRate).Icon, { className: 'h-3.5 w-3.5' })}
            </span>
          )}
        </div>
        {stats7 ? (
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-lg font-bold">{stats7.hitRate.toFixed(1)}%</span>
              <Badge 
                variant={stats7.roi > 0 ? 'default' : 'secondary'}
                className="text-xs"
              >
                {stats7.roi > 0 ? '+' : ''}{stats7.roi.toFixed(0)}%
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats7.correctPredictions}/{stats7.totalPredictions} hits
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data</p>
        )}
      </div>

      {/* 14-Day Summary */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">14 Days</span>
          {stats14 && (
            <span className={getTrendIcon(stats14.hitRate).color}>
              {React.createElement(getTrendIcon(stats14.hitRate).Icon, { className: 'h-3.5 w-3.5' })}
            </span>
          )}
        </div>
        {stats14 ? (
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-lg font-bold">{stats14.hitRate.toFixed(1)}%</span>
              <Badge 
                variant={stats14.roi > 0 ? 'default' : 'destructive'}
                className="text-xs"
              >
                {stats14.roi > 0 ? '+' : ''}{stats14.roi.toFixed(0)}%
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats14.correctPredictions}/{stats14.totalPredictions} hits
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data</p>
        )}
      </div>

      {/* 30-Day Summary */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">30 Days</span>
          {stats30 && (
            <span className={getTrendIcon(stats30.hitRate).color}>
              {React.createElement(getTrendIcon(stats30.hitRate).Icon, { className: 'h-3.5 w-3.5' })}
            </span>
          )}
        </div>
        {stats30 ? (
          <div className="space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-lg font-bold">{stats30.hitRate.toFixed(1)}%</span>
              <Badge 
                variant={stats30.roi > 0 ? 'default' : 'secondary'}
                className="text-xs"
              >
                {stats30.roi > 0 ? '+' : ''}{stats30.roi.toFixed(0)}%
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats30.correctPredictions}/{stats30.totalPredictions} hits
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No data</p>
        )}
      </div>
    </div>
  );
}
