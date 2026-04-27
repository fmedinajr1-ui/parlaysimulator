import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

const FLOOR = 60;

const SIGNALS: { type: string; label: string; emoji: string }[] = [
  { type: "cascade", label: "Cascade", emoji: "🌊" },
  { type: "take_it_now", label: "Take It Now", emoji: "💰" },
  { type: "velocity_spike", label: "Velocity Spike", emoji: "⚡" },
];

type Range = 1 | 7 | 30;

interface RangeRow {
  signal_type: string;
  hits: number;
  misses: number;
  pending: number;
  total: number;
  hitRate: number | null;
  vsFloor: number | null;
}

export function MultiSportSignalAccuracy() {
  const [range, setRange] = useState<Range>(1);
  const [dayOffset, setDayOffset] = useState(0); // only used when range=1

  const { data, isLoading } = useQuery({
    queryKey: ["multi-sport-signal-accuracy", range, dayOffset],
    queryFn: async () => {
      let startISO: string;
      let endISO: string;
      let label: string;

      if (range === 1) {
        const day = subDays(new Date(), dayOffset);
        const dayStr = format(day, "yyyy-MM-dd");
        startISO = `${dayStr}T00:00:00`;
        endISO = `${dayStr}T23:59:59.999`;
        label = format(day, "MMM d, yyyy");
      } else {
        startISO = subDays(new Date(), range).toISOString();
        endISO = new Date().toISOString();
        label = `Last ${range} days`;
      }

      const { data: rows, error } = await supabase
        .from("fanduel_prediction_accuracy")
        .select("signal_type, was_correct")
        .in("signal_type", SIGNALS.map((s) => s.type))
        .gte("created_at", startISO)
        .lte("created_at", endISO);

      if (error) throw error;

      const result: RangeRow[] = SIGNALS.map((s) => {
        const filtered = (rows || []).filter((r) => r.signal_type === s.type);
        let hits = 0;
        let misses = 0;
        let pending = 0;
        for (const r of filtered) {
          if (r.was_correct === true) hits++;
          else if (r.was_correct === false) misses++;
          else pending++;
        }
        const settled = hits + misses;
        const hitRate = settled > 0 ? Math.round((hits / settled) * 1000) / 10 : null;
        return {
          signal_type: s.type,
          hits,
          misses,
          pending,
          total: filtered.length,
          hitRate,
          vsFloor: hitRate !== null ? Math.round((hitRate - FLOOR) * 10) / 10 : null,
        };
      });

      return { rows: result, label };
    },
    staleTime: 1000 * 60 * 5,
  });

  const rows = data?.rows ?? [];
  const label = data?.label ?? "";

  const totalSettled = rows.reduce((s, r) => s + r.hits + r.misses, 0);
  const totalHits = rows.reduce((s, r) => s + r.hits, 0);
  const overallRate =
    totalSettled > 0 ? Math.round((totalHits / totalSettled) * 1000) / 10 : null;

  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span>📡</span>
          Multi-Sport Signal Accuracy
        </h3>
        <Tabs
          value={range.toString()}
          onValueChange={(v) => {
            setRange(Number(v) as Range);
            setDayOffset(0);
          }}
        >
          <TabsList className="bg-muted/30 h-7">
            <TabsTrigger value="1" className="text-xs h-6">Day</TabsTrigger>
            <TabsTrigger value="7" className="text-xs h-6">7d</TabsTrigger>
            <TabsTrigger value="30" className="text-xs h-6">30d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          Hit rate vs {FLOOR}% confidence floor · {label}
        </p>
        {range === 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setDayOffset((d) => d + 1)}
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={dayOffset === 0}
              onClick={() => setDayOffset((d) => Math.max(0, d - 1))}
            >
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Overall summary */}
      {overallRate !== null && (
        <div className="flex items-baseline gap-3 mb-4 p-3 rounded-lg bg-muted/20">
          <span
            className={cn(
              "font-bold text-2xl",
              overallRate >= FLOOR ? "text-green-400" : "text-red-400",
            )}
          >
            {overallRate.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">
            Combined · {totalHits}W – {totalSettled - totalHits}L
          </span>
          <span
            className={cn(
              "ml-auto text-xs font-semibold",
              overallRate >= FLOOR ? "text-green-400" : "text-red-400",
            )}
          >
            {overallRate >= FLOOR ? "+" : ""}
            {(overallRate - FLOOR).toFixed(1)} vs floor
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted/30 animate-pulse rounded" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const meta = SIGNALS.find((s) => s.type === row.signal_type)!;
            const settled = row.hits + row.misses;
            const passes = row.hitRate !== null && row.hitRate >= FLOOR;
            const progress = row.hitRate !== null ? Math.min(100, row.hitRate) : 0;

            return (
              <div
                key={row.signal_type}
                className="p-3 rounded-lg bg-muted/20 border border-border/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.emoji}</span>
                    <span className="text-sm font-medium">{meta.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.hitRate !== null ? (
                      <span
                        className={cn(
                          "text-base font-bold",
                          passes ? "text-green-400" : "text-red-400",
                        )}
                      >
                        {row.hitRate.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No settled</span>
                    )}
                    {row.vsFloor !== null && (
                      <span
                        className={cn(
                          "text-xs font-semibold px-1.5 py-0.5 rounded",
                          passes
                            ? "bg-green-500/15 text-green-400"
                            : "bg-red-500/15 text-red-400",
                        )}
                      >
                        {row.vsFloor >= 0 ? "+" : ""}
                        {row.vsFloor.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Hit-rate bar with 60% floor marker */}
                <div className="relative">
                  <Progress
                    value={progress}
                    className={cn(
                      "h-2",
                      passes
                        ? "[&>div]:bg-green-500"
                        : "[&>div]:bg-red-500",
                    )}
                  />
                  {/* 60% floor marker */}
                  <div
                    className="absolute top-0 bottom-0 w-px bg-yellow-400/80"
                    style={{ left: `${FLOOR}%` }}
                    title="60% floor"
                  />
                </div>

                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>
                    {row.hits}✅ {row.misses}❌
                    {row.pending > 0 && ` · ${row.pending}⏳`}
                  </span>
                  <span>{settled} settled / {row.total} alerts</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="inline-block w-2 h-2 bg-yellow-400 rounded-sm" />
        Yellow line = 60% confidence floor (pre-broadcast gate)
      </div>
    </Card>
  );
}
