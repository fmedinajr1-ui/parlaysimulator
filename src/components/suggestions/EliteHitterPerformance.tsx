import { useEliteHitterHistory } from '@/hooks/useEliteHitterHistory';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Flame, Target, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatUnits } from '@/utils/roiCalculator';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  ResponsiveContainer, 
  Tooltip,
  ReferenceLine
} from 'recharts';

const engineColors: Record<string, string> = {
  'MedianLock': 'text-cyan-400',
  'HitRate': 'text-green-400',
  'Sharp': 'text-yellow-400',
  'PVS': 'text-purple-400',
  'Fatigue': 'text-orange-400',
};

export function EliteHitterPerformance() {
  const { data, isLoading } = useEliteHitterHistory();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No historical data available yet.
      </div>
    );
  }

  const { stats } = data;
  const hasSettledParlays = stats.won + stats.lost > 0;

  return (
    <div className="space-y-4">
      {/* Overall Record */}
      <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            <span className="font-semibold">Overall Record</span>
          </div>
          <Badge 
            variant="outline" 
            className={cn(
              "text-sm",
              stats.winRate >= 50 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"
            )}
          >
            {stats.won}-{stats.lost}{stats.pending > 0 && `-${stats.pending}`}
          </Badge>
        </div>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Win Rate</span>
            <span className={cn(
              "font-semibold",
              stats.winRate >= 50 ? "text-green-500" : "text-red-500"
            )}>
              {stats.winRate.toFixed(1)}%
            </span>
          </div>
          <Progress 
            value={hasSettledParlays ? stats.winRate : 0} 
            className="h-2" 
          />
        </div>

        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-muted-foreground">ROI</span>
          <span className={cn(
            "font-semibold",
            stats.netProfit >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {formatUnits(stats.netProfit)} ({stats.totalROI >= 0 ? '+' : ''}{stats.totalROI.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Streak Info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Flame className={cn(
              "w-4 h-4",
              stats.currentStreak.type === 'W' ? "text-green-500" : 
              stats.currentStreak.type === 'L' ? "text-red-500" : "text-muted-foreground"
            )} />
            <span className="text-xs text-muted-foreground">Current</span>
          </div>
          <div className={cn(
            "text-lg font-bold",
            stats.currentStreak.type === 'W' ? "text-green-500" : 
            stats.currentStreak.type === 'L' ? "text-red-500" : "text-muted-foreground"
          )}>
            {stats.currentStreak.count > 0 
              ? `${stats.currentStreak.count}${stats.currentStreak.type}` 
              : '--'}
          </div>
        </div>
        
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-yellow-500" />
            <span className="text-xs text-muted-foreground">Best/Worst</span>
          </div>
          <div className="text-sm">
            <span className="text-green-500 font-semibold">{stats.bestWinStreak}W</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span className="text-red-500 font-semibold">{stats.worstLossStreak}L</span>
          </div>
        </div>
      </div>

      {/* ROI Trend Chart */}
      {stats.roiTrend.length > 1 && (
        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2 mb-3">
            {stats.netProfit >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm font-medium">ROI Trend</span>
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.roiTrend}>
                <defs>
                  <linearGradient id="roiGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="date" 
                  tick={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}u`, 'ROI']}
                  labelFormatter={(label) => `Date: ${label}`}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Area 
                  type="monotone" 
                  dataKey="cumulativeROI" 
                  stroke="hsl(var(--primary))" 
                  fill="url(#roiGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Engine Performance */}
      {stats.byEngine.length > 0 && (
        <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
          <span className="text-sm font-medium mb-3 block">Performance by Engine</span>
          <div className="space-y-2">
            {stats.byEngine.map((engine) => (
              <div 
                key={engine.engine} 
                className="flex items-center justify-between text-sm"
              >
                <span className={cn("font-medium", engineColors[engine.engine] || 'text-foreground')}>
                  {engine.engine}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {engine.won}-{engine.lost}
                  </span>
                  <span className={cn(
                    "font-semibold",
                    engine.winRate >= 50 ? "text-green-500" : "text-red-500"
                  )}>
                    {engine.winRate.toFixed(0)}%
                  </span>
                  <span className={cn(
                    "text-xs",
                    engine.profit >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {formatUnits(engine.profit)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Size Note */}
      {stats.won + stats.lost < 10 && (
        <p className="text-xs text-muted-foreground text-center">
          * Stats based on {stats.won + stats.lost} settled parlays. More data needed for reliable metrics.
        </p>
      )}
    </div>
  );
}
