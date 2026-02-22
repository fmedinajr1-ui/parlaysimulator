import React from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { WarRoomPropData } from './WarRoomPropCard';

interface HedgeModeTableProps {
  props: WarRoomPropData[];
}

const PROP_SHORT: Record<string, string> = {
  points: 'PTS', assists: 'AST', threes: '3PT',
  rebounds: 'REB', blocks: 'BLK', steals: 'STL',
};

function HelpTip({ children, tip, side = 'top' }: { children: React.ReactNode; tip: string; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} className="max-w-[200px] text-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function progressColor(pct: number): string {
  if (pct >= 70) return 'bg-[hsl(var(--warroom-green))]';
  if (pct >= 40) return 'bg-[hsl(var(--warroom-gold))]';
  return 'bg-[hsl(var(--warroom-danger))]';
}

function actionPill(suggestion: string) {
  const styles: Record<string, string> = {
    LOCK: 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))] border-[hsl(var(--warroom-green)/0.3)]',
    HOLD: 'bg-[hsl(var(--warroom-card-border)/0.3)] text-foreground border-[hsl(var(--warroom-card-border))]',
    MONITOR: 'bg-[hsl(var(--warroom-gold)/0.15)] text-[hsl(var(--warroom-gold))] border-[hsl(var(--warroom-gold)/0.3)]',
    EXIT: 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))] border-[hsl(var(--warroom-danger)/0.3)]',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', styles[suggestion] ?? styles.HOLD)}>
      {suggestion}
    </span>
  );
}

export function HedgeModeTable({ props }: HedgeModeTableProps) {
  if (props.length === 0) {
    return (
      <div className="warroom-card p-4 text-center text-sm text-muted-foreground">
        No live props to display in Hedge Mode.
      </div>
    );
  }

  // Survival % — average progress toward line
  const heats = props.map((p) => {
    const isOver = p.side?.toUpperCase() !== 'UNDER';
    return isOver
      ? Math.min(100, (p.currentValue / Math.max(p.line, 0.1)) * 100)
      : Math.min(100, Math.max(0, ((p.line - p.currentValue) / Math.max(p.line, 0.1)) * 100));
  });
  const avgHeat = heats.reduce((s, h) => s + h, 0) / heats.length;
  const survivalPct = Math.round(Math.min(99, Math.max(1, avgHeat * 0.9)));
  const survivalColor = survivalPct >= 60 ? 'text-[hsl(var(--warroom-green))]' : survivalPct >= 35 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]';

  return (
    <div className="warroom-card overflow-hidden">
      {/* Header with survival badge */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--warroom-card-border))]">
        <span className="text-xs font-semibold text-foreground">Hedge Monitor</span>
        <HelpTip tip="Estimated chance your entire parlay survives based on current progress across all legs.">
          <div className="flex items-center gap-1.5 cursor-help">
            <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            <span className={cn('text-sm font-bold border-b border-dotted border-muted-foreground/30', survivalColor)}>
              {survivalPct}% survival
            </span>
          </div>
        </HelpTip>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[hsl(var(--warroom-card-border))] text-muted-foreground text-[10px] uppercase tracking-wider">
              <th className="text-left font-medium p-2">Prop</th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="Player's current stat total in this game.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Now</span>
                </HelpTip>
              </th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="The line the player needs to hit for the bet to cash.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Need</span>
                </HelpTip>
              </th>
              <th className="text-left font-medium p-2 pl-4 w-24">
                <HelpTip tip="Visual tracker: how close the player is to clearing the line.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Progress</span>
                </HelpTip>
              </th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="AI estimate of the player's final stat line.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Projected</span>
                </HelpTip>
              </th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="Difference between projected final and the line. Positive = on track, negative = behind.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Gap</span>
                </HelpTip>
              </th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="Suggested action: LOCK (strong hold), HOLD (on pace), MONITOR (close), EXIT (consider hedging).">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Action</span>
                </HelpTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {props.map((p, i) => {
              const edge = p.projectedFinal - p.line;
              const hedgeSuggestion = edge > 2 ? 'LOCK' : edge > 0 ? 'HOLD' : edge > -2 ? 'MONITOR' : 'EXIT';
              const pct = heats[i];

              return (
                <motion.tr
                  key={p.id}
                  layout
                  className="border-b border-[hsl(var(--warroom-card-border)/0.5)] hover:bg-[hsl(var(--warroom-card-border)/0.3)]"
                >
                  <td className="p-2">
                    <span className="font-medium text-foreground">{p.playerName}</span>
                    <span className="text-muted-foreground ml-1">
                      {PROP_SHORT[p.propType] || p.propType}
                    </span>
                  </td>
                  <td className="text-right p-2 tabular-nums font-medium text-foreground">
                    {p.currentValue}
                  </td>
                  <td className="text-right p-2 tabular-nums text-muted-foreground">
                    {p.line}
                  </td>
                  <td className="p-2 pl-4">
                    <div className="h-1.5 w-full rounded-full bg-[hsl(var(--warroom-card-border)/0.5)] overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', progressColor(pct))}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="text-right p-2 tabular-nums font-medium text-foreground">
                    {p.projectedFinal.toFixed(1)}
                  </td>
                  <td className={cn(
                    'text-right p-2 tabular-nums font-bold',
                    edge > 0 ? 'text-[hsl(var(--warroom-green))]' : edge < -1 ? 'text-[hsl(var(--warroom-danger))]' : 'text-muted-foreground'
                  )}>
                    {edge >= 0 ? '+' : ''}{edge.toFixed(1)}
                  </td>
                  <td className="text-right p-2">
                    {actionPill(hedgeSuggestion)}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
