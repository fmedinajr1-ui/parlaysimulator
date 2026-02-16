import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CalendarDay {
  date: string;
  profitLoss: number;
  won: number;
  lost: number;
  isProfitable: boolean;
}

interface PerformanceCalendarProps {
  days: CalendarDay[];
  hasBotAccess: boolean;
}

export function PerformanceCalendar({ days, hasBotAccess }: PerformanceCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    days.forEach(d => map.set(d.date, d));
    return map;
  }, [days]);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  return (
    <section className="py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-foreground mb-6 text-center font-bebas tracking-wide">
          Performance Calendar
        </h2>

        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="icon" onClick={prevMonth}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="text-lg font-semibold text-foreground">{monthLabel}</span>
          <Button variant="ghost" size="icon" onClick={nextMonth}>
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const data = dayMap.get(dateStr);

            return (
              <div
                key={day}
                className={`aspect-square rounded-lg border flex flex-col items-center justify-center text-xs transition-colors ${
                  data
                    ? data.profitLoss === 0
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                      : data.isProfitable
                        ? 'bg-accent/15 border-accent/30 text-accent'
                        : 'bg-destructive/15 border-destructive/30 text-destructive'
                    : 'border-border/50 text-muted-foreground/50'
                }`}
              >
                <span className="font-medium">{day}</span>
                {data && (
                  <span className="text-[10px] font-bold mt-0.5">
                    {data.profitLoss === 0 ? 'Even' : `${data.profitLoss >= 0 ? '+' : ''}${data.profitLoss.toFixed(0)}`}
                  </span>
                )}
                {data && !hasBotAccess && (
                  <Lock className="w-2.5 h-2.5 mt-0.5 opacity-50" />
                )}
              </div>
            );
          })}
        </div>

        {!hasBotAccess && (
          <p className="text-center text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1">
            <Lock className="w-3 h-3" /> Subscribe to view full parlay breakdowns
          </p>
        )}
      </div>
    </section>
  );
}
