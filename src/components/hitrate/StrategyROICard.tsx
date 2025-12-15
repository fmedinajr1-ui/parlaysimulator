import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, DollarSign, Target, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StrategyROICardProps {
  compact?: boolean;
}

export function StrategyROICard({ compact = false }: StrategyROICardProps) {
  const { data: strategyData, isLoading } = useQuery({
    queryKey: ['strategy-performance-roi'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('strategy_performance')
        .select('*')
        .order('roi_percentage', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  if (isLoading) {
    return (
      <Card className="bg-card/60 border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!strategyData || strategyData.length === 0) {
    return null;
  }

  const profitableStrategies = strategyData.filter(s => (s.roi_percentage || 0) > 0);
  const unprofitableStrategies = strategyData.filter(s => (s.roi_percentage || 0) < 0);

  const getROIColor = (roi: number) => {
    if (roi >= 10) return 'text-chart-2';
    if (roi > 0) return 'text-emerald-400';
    if (roi > -5) return 'text-chart-4';
    return 'text-destructive';
  };

  const getROIBadgeStyles = (roi: number) => {
    if (roi >= 10) return 'bg-chart-2/20 text-chart-2 border-chart-2/30';
    if (roi > 0) return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (roi > -5) return 'bg-chart-4/20 text-chart-4 border-chart-4/30';
    return 'bg-destructive/20 text-destructive border-destructive/30';
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {strategyData.slice(0, 3).map(strategy => (
          <Badge 
            key={strategy.id}
            variant="outline"
            className={cn('gap-1', getROIBadgeStyles(strategy.roi_percentage || 0))}
          >
            {(strategy.roi_percentage || 0) >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {strategy.strategy_name}: {(strategy.roi_percentage || 0).toFixed(1)}%
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-chart-2" />
          Strategy ROI Performance
          <Badge variant="secondary" className="text-[10px] ml-auto">
            Historical
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Best Performers */}
        {profitableStrategies.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-chart-2">
              <TrendingUp className="h-4 w-4" />
              <span className="font-medium">Profitable Strategies</span>
            </div>
            <div className="grid gap-2">
              {profitableStrategies.slice(0, 3).map(strategy => (
                <div 
                  key={strategy.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-chart-2/5 border border-chart-2/20"
                >
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-chart-2" />
                    <span className="text-sm font-medium">{strategy.strategy_name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {strategy.total_suggestions || 0} bets
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Win Rate</p>
                      <p className="text-sm font-medium">{(strategy.win_rate || 0).toFixed(1)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">ROI</p>
                      <p className={cn('text-sm font-bold', getROIColor(strategy.roi_percentage || 0))}>
                        +{(strategy.roi_percentage || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Underperformers */}
        {unprofitableStrategies.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">Avoid These</span>
            </div>
            <div className="grid gap-2">
              {unprofitableStrategies.slice(0, 2).map(strategy => (
                <div 
                  key={strategy.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/5 border border-destructive/20"
                >
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    <span className="text-sm">{strategy.strategy_name}</span>
                  </div>
                  <Badge 
                    variant="outline" 
                    className="text-destructive border-destructive/30"
                  >
                    {(strategy.roi_percentage || 0).toFixed(1)}% ROI
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total strategies tracked: {strategyData.length}</span>
            <span>
              Profitable: {profitableStrategies.length}/{strategyData.length}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
