import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, getDay, subMonths, addMonths, isFuture } from 'date-fns';

export interface DayPnL {
  date: string;
  profitLoss: number;
  isProfitable: boolean;
  parlaysWon: number;
  parlaysLost: number;
  bankroll: number;
}

export interface MonthStats {
  totalPnL: number;
  winDays: number;
  lossDays: number;
  bestDay: { date: string; amount: number } | null;
  worstDay: { date: string; amount: number } | null;
  currentStreak: number;
  bestStreak: number;
  roi: number;
}

export function useBotPnLCalendar() {
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd');

  const { data: rawDays, isLoading } = useQuery({
    queryKey: ['bot-pnl-calendar', monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_activation_status')
        .select('check_date, daily_profit_loss, is_profitable_day, parlays_won, parlays_lost, simulated_bankroll')
        .gte('check_date', monthStart)
        .lte('check_date', monthEnd)
        .order('check_date', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });

  const dailyMap = useMemo(() => {
    const map = new Map<string, DayPnL>();
    (rawDays || []).forEach((d) => {
      map.set(d.check_date, {
        date: d.check_date,
        profitLoss: d.daily_profit_loss ?? 0,
        isProfitable: d.is_profitable_day ?? false,
        parlaysWon: d.parlays_won ?? 0,
        parlaysLost: d.parlays_lost ?? 0,
        bankroll: d.simulated_bankroll ?? 0,
      });
    });
    return map;
  }, [rawDays]);

  const calendarDays = useMemo(() => {
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);
    const days = eachDayOfInterval({ start, end });
    const startDayOfWeek = getDay(start); // 0=Sun
    return { days, startDayOfWeek };
  }, [selectedMonth]);

  const stats: MonthStats = useMemo(() => {
    const entries = Array.from(dailyMap.values());
    if (entries.length === 0) {
      return { totalPnL: 0, winDays: 0, lossDays: 0, bestDay: null, worstDay: null, currentStreak: 0, bestStreak: 0, roi: 0 };
    }

    const totalPnL = entries.reduce((s, d) => s + d.profitLoss, 0);
    const winDays = entries.filter((d) => d.isProfitable).length;
    const lossDays = entries.filter((d) => !d.isProfitable && d.profitLoss !== 0).length;

    let bestDay: MonthStats['bestDay'] = null;
    let worstDay: MonthStats['worstDay'] = null;
    entries.forEach((d) => {
      if (!bestDay || d.profitLoss > bestDay.amount) bestDay = { date: d.date, amount: d.profitLoss };
      if (!worstDay || d.profitLoss < worstDay.amount) worstDay = { date: d.date, amount: d.profitLoss };
    });

    // Streak calculation (from end of sorted entries)
    let currentStreak = 0;
    let bestStreak = 0;
    let streak = 0;
    for (const d of entries) {
      if (d.isProfitable) {
        streak++;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 0;
      }
    }
    // Current streak = streak at end
    currentStreak = streak;

    const totalStaked = entries.length * 10;
    const roi = totalStaked > 0 ? (totalPnL / totalStaked) * 100 : 0;

    return { totalPnL, winDays, lossDays, bestDay, worstDay, currentStreak, bestStreak, roi };
  }, [dailyMap]);

  const goToPrevMonth = () => setSelectedMonth((m) => subMonths(m, 1));
  const goToNextMonth = () => {
    const next = addMonths(selectedMonth, 1);
    if (!isFuture(startOfMonth(next)) || format(next, 'yyyy-MM') === format(new Date(), 'yyyy-MM')) {
      setSelectedMonth(next);
    }
  };
  const canGoNext = format(selectedMonth, 'yyyy-MM') !== format(new Date(), 'yyyy-MM');

  return {
    selectedMonth,
    setSelectedMonth,
    selectedDate,
    setSelectedDate,
    calendarDays,
    dailyMap,
    stats,
    isLoading,
    goToPrevMonth,
    goToNextMonth,
    canGoNext,
  };
}
