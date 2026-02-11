import React from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useBotPnLCalendar } from '@/hooks/useBotPnLCalendar';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
} from 'recharts';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function getHeatmapIntensity(amount: number, maxAbsAmount: number): number {
  if (maxAbsAmount === 0) return 0.15;
  return Math.max(0.15, Math.min(1, Math.abs(amount) / maxAbsAmount));
}

export function BotPnLCalendar() {
  const {
    selectedMonth,
    calendarDays,
    dailyMap,
    stats,
    isLoading,
    goToPrevMonth,
    goToNextMonth,
    canGoNext,
  } = useBotPnLCalendar();

  if (isLoading) {
    return <Skeleton className="h-80 w-full rounded-xl" />;
  }

  const formatPnL = (val: number) => (val >= 0 ? `+$${val.toFixed(0)}` : `-$${Math.abs(val).toFixed(0)}`);

  // Calculate max absolute PnL for heatmap scaling
  const allPnLValues = Array.from(dailyMap.values()).map(d => Math.abs(d.profitLoss)).filter(v => v > 0);
  const maxAbsPnL = allPnLValues.length > 0 ? Math.max(...allPnLValues) : 100;

  // Sparkline data
  const sparklineData = Array.from(dailyMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date.slice(5), pnl: d.profitLoss }));

  const monthKey = format(selectedMonth, 'yyyy-MM');

  return (
    <Card>
      <CardHeader className="pb-2">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">P&L Calendar</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToPrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {format(selectedMonth, 'MMMM yyyy')}
            </span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToNextMonth} disabled={!canGoNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className={cn('text-sm font-bold', stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400')}>
              {formatPnL(stats.totalPnL)}
            </p>
            <p className="text-[10px] text-muted-foreground">Total P&L</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-sm font-bold">
              <span className="text-green-400">{stats.winDays}W</span>
              <span className="text-muted-foreground mx-0.5">-</span>
              <span className="text-red-400">{stats.lossDays}L</span>
            </p>
            <p className="text-[10px] text-muted-foreground">Record</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-sm font-bold flex items-center justify-center gap-1">
              <Flame className="h-3 w-3 text-orange-400" />
              {stats.currentStreak}W
            </p>
            <p className="text-[10px] text-muted-foreground">Streak</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2 space-y-3">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_LABELS.map((d, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid with animation */}
        <AnimatePresence mode="wait">
          <motion.div
            key={monthKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-7 gap-1"
          >
            {/* Empty cells for offset */}
            {Array.from({ length: calendarDays.startDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-square" />
            ))}

            <TooltipProvider delayDuration={200}>
              {calendarDays.days.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const data = dailyMap.get(dateStr);
                const hasData = !!data && data.profitLoss !== 0;
                const isProfitable = data?.isProfitable ?? false;
                const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');
                const intensity = hasData ? getHeatmapIntensity(data!.profitLoss, maxAbsPnL) : 0;

                const cellContent = (
                  <div
                    className={cn(
                      'aspect-square rounded-md flex flex-col items-center justify-center text-[10px] border transition-colors',
                      !hasData && 'border-border/30 text-muted-foreground',
                      isToday && 'ring-1 ring-primary'
                    )}
                    style={hasData ? {
                      backgroundColor: isProfitable
                        ? `hsl(145 100% 45% / ${intensity * 0.25})`
                        : `hsl(0 80% 55% / ${intensity * 0.25})`,
                      borderColor: isProfitable
                        ? `hsl(145 100% 45% / ${intensity * 0.5})`
                        : `hsl(0 80% 55% / ${intensity * 0.5})`,
                      color: isProfitable
                        ? `hsl(145 100% 55%)`
                        : `hsl(0 80% 60%)`,
                    } : undefined}
                  >
                    <span className={cn('font-medium', isToday && 'text-primary')}>
                      {format(day, 'd')}
                    </span>
                    {hasData && (
                      <span className="text-[8px] font-bold leading-tight">
                        {data!.profitLoss >= 0 ? '+' : ''}{data!.profitLoss.toFixed(0)}
                      </span>
                    )}
                  </div>
                );

                if (!hasData) return <React.Fragment key={dateStr}>{cellContent}</React.Fragment>;

                return (
                  <Tooltip key={dateStr}>
                    <TooltipTrigger asChild>{cellContent}</TooltipTrigger>
                    <TooltipContent side="top" className="text-xs space-y-1">
                      <p className="font-medium">{format(day, 'MMM d')}</p>
                      <p className={isProfitable ? 'text-green-400' : 'text-red-400'}>
                        P&L: {formatPnL(data!.profitLoss)}
                      </p>
                      <p>Won: {data!.parlaysWon} / Lost: {data!.parlaysLost}</p>
                      <p>Bankroll: ${data!.bankroll.toLocaleString()}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </TooltipProvider>
          </motion.div>
        </AnimatePresence>

        {/* Mini Sparkline */}
        {sparklineData.length > 1 && (
          <div className="h-16 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <defs>
                  <linearGradient id="sparkPnlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis hide domain={['dataMin - 20', 'dataMax + 20']} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                  formatter={(value: number) => [`$${value.toFixed(0)}`, 'P&L']}
                />
                <Area
                  type="monotone"
                  dataKey="pnl"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  fill="url(#sparkPnlGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
