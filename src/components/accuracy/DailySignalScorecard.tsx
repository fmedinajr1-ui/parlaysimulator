import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";

interface SignalRow {
  signal_type: string;
  hits: number;
  misses: number;
  pending: number;
}

const SIGNAL_EMOJI: Record<string, string> = {
  team_news_shift: "📰",
  correlated_movement: "🔗",
  take_it_now: "💰",
  velocity_spike: "⚡",
  cascade: "🌊",
  line_about_to_move: "🔮",
  snapback: "🔄",
  live_drift: "🔴",
  trap_warning: "🪤",
  perfect_line: "🎯",
};

const SIGNAL_LABEL: Record<string, string> = {
  team_news_shift: "Team News Shift",
  correlated_movement: "Correlated Movement",
  take_it_now: "Take It Now",
  velocity_spike: "Velocity Spike",
  cascade: "Cascade",
  line_about_to_move: "Line About to Move",
  snapback: "Snapback",
  live_drift: "Live Drift",
  trap_warning: "Trap Warning",
  perfect_line: "Perfect Line",
};

export function DailySignalScorecard() {
  const [selectedDate, setSelectedDate] = useState<Date>(subDays(new Date(), 1));

  const dateStr = format(selectedDate, "yyyy-MM-dd");

  const { data: signals, isLoading } = useQuery({
    queryKey: ["daily-signal-scorecard", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fanduel_prediction_accuracy")
        .select("signal_type, was_correct")
        .gte("created_at", `${dateStr}T00:00:00`)
        .lt("created_at", `${dateStr}T23:59:59.999`);

      if (error) throw error;

      const map = new Map<string, SignalRow>();
      for (const row of data || []) {
        const st = row.signal_type || "unknown";
        if (!map.has(st)) map.set(st, { signal_type: st, hits: 0, misses: 0, pending: 0 });
        const entry = map.get(st)!;
        if (row.was_correct === true) entry.hits++;
        else if (row.was_correct === false) entry.misses++;
        else entry.pending++;
      }

      // Sort: team_news_shift and correlated_movement first, then by total volume
      const prioritySignals = ["team_news_shift", "correlated_movement"];
      return Array.from(map.values()).sort((a, b) => {
        const aPriority = prioritySignals.indexOf(a.signal_type);
        const bPriority = prioritySignals.indexOf(b.signal_type);
        if (aPriority !== -1 && bPriority === -1) return -1;
        if (bPriority !== -1 && aPriority === -1) return 1;
        if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
        return (b.hits + b.misses + b.pending) - (a.hits + a.misses + a.pending);
      });
    },
    staleTime: 1000 * 60 * 5,
  });

  const goDay = (delta: number) => {
    setSelectedDate(prev => subDays(prev, -delta));
  };

  const totalHits = signals?.reduce((s, r) => s + r.hits, 0) ?? 0;
  const totalMisses = signals?.reduce((s, r) => s + r.misses, 0) ?? 0;
  const totalPending = signals?.reduce((s, r) => s + r.pending, 0) ?? 0;
  const totalSettled = totalHits + totalMisses;
  const overallRate = totalSettled > 0 ? Math.round((totalHits / totalSettled) * 100) : null;

  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span>📅</span>
          Daily Signal Scorecard
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goDay(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
                <CalendarIcon className="w-3 h-3" />
                {format(selectedDate, "MMM d")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                disabled={(d) => d > new Date()}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goDay(1)}
            disabled={format(selectedDate, "yyyy-MM-dd") >= format(new Date(), "yyyy-MM-dd")}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {overallRate !== null && (
        <div className="flex items-center gap-3 mb-3 text-sm">
          <span className={cn(
            "font-bold text-lg",
            overallRate >= 55 ? "text-green-400" : overallRate >= 50 ? "text-yellow-400" : "text-red-400"
          )}>
            {overallRate}%
          </span>
          <span className="text-muted-foreground">
            {totalHits}W - {totalMisses}L
            {totalPending > 0 && ` • ${totalPending} pending`}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-muted/30 animate-pulse rounded" />
          ))}
        </div>
      ) : !signals || signals.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No signals recorded for {format(selectedDate, "MMM d, yyyy")}
        </p>
      ) : (
        <div className="space-y-1.5">
          {signals.map((row) => {
            const settled = row.hits + row.misses;
            const rate = settled > 0 ? Math.round((row.hits / settled) * 100) : null;
            const emoji = SIGNAL_EMOJI[row.signal_type] || "📊";
            const label = SIGNAL_LABEL[row.signal_type] || row.signal_type;

            return (
              <div
                key={row.signal_type}
                className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/20"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base">{emoji}</span>
                  <span className="truncate">{label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {rate !== null ? (
                    <span className={cn(
                      "font-semibold text-xs",
                      rate >= 55 ? "text-green-400" : rate >= 50 ? "text-yellow-400" : "text-red-400"
                    )}>
                      {rate}%
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {row.hits}✅ {row.misses}❌
                    {row.pending > 0 && ` ${row.pending}⏳`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
