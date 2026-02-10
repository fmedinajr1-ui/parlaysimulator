import React from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useBotPnLCalendar } from '@/hooks/useBotPnLCalendar';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

        {/* Best / Worst / ROI row */}
        <div className="flex flex-wrap gap-2 mt-2">
          {stats.bestDay && (
            <Badge variant="outline" className="text-green-400 border-green-400/30 text-[10px]">
              <TrendingUp className="h-3 w-3 mr-1" />
              Best: {formatPnL(stats.bestDay.amount)}
            </Badge>
          )}
          {stats.worstDay && (
            <Badge variant="outline" className="text-red-400 border-red-400/30 text-[10px]">
              <TrendingDown className="h-3 w-3 mr-1" />
              Worst: {formatPnL(stats.worstDay.amount)}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            ROI: {stats.roi.toFixed(1)}%
          </Badge>
          {stats.bestStreak > 0 && (
            <Badge variant="outline" className="text-orange-400 border-orange-400/30 text-[10px]">
              Best Streak: {stats.bestStreak}W
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {DAY_LABELS.map((d, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {/* Empty cells for offset */}
          {Array.from({ length: calendarDays.startDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {calendarDays.days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const data = dailyMap.get(dateStr);
            const hasData = !!data && data.profitLoss !== 0;
            const isProfitable = data?.isProfitable ?? false;
            const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

            return (
              <div
                key={dateStr}
                className={cn(
                  'aspect-square rounded-md flex flex-col items-center justify-center text-[10px] border transition-colors',
                  hasData && isProfitable && 'bg-green-500/15 border-green-500/30 text-green-400',
                  hasData && !isProfitable && 'bg-red-500/15 border-red-500/30 text-red-400',
                  !hasData && 'border-border/30 text-muted-foreground',
                  isToday && 'ring-1 ring-primary'
                )}
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
          })}
        </div>
      </CardContent>
    </Card>
  );
}
