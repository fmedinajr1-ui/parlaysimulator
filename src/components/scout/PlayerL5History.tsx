import React from 'react';
import { usePlayerL5Stats } from '@/hooks/usePlayerL5Stats';
import { cn } from '@/lib/utils';

interface PlayerL5HistoryProps {
  playerName: string;
  propType: string;
  line: number;
  lean: 'OVER' | 'UNDER';
}

export function PlayerL5History({ playerName, propType, line, lean }: PlayerL5HistoryProps) {
  const { data, isLoading } = usePlayerL5Stats(playerName, propType, line, lean);

  if (isLoading || !data || data.total === 0) return null;

  const hitPct = Math.round((data.hitCount / data.total) * 100);

  return (
    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium shrink-0">L5:</span>
      <div className="flex items-center gap-1">
        {data.games.map((g, i) => {
          const hit = lean === 'OVER' ? g.value > line : g.value < line;
          return (
            <span key={i} className="flex flex-col items-center gap-0.5">
              <span className={cn("font-mono", hit ? "text-chart-2" : "text-destructive")}>{g.value}</span>
              <span className={cn("w-1.5 h-1.5 rounded-full", hit ? "bg-chart-2" : "bg-destructive")} />
            </span>
          );
        })}
      </div>
      <span className="ml-1 shrink-0">
        <span className={cn("font-bold", hitPct >= 60 ? "text-chart-2" : hitPct >= 40 ? "text-chart-3" : "text-destructive")}>
          {data.hitCount}/{data.total}
        </span>
        {' '}hit {lean} {line} ({hitPct}%)
      </span>
    </div>
  );
}
