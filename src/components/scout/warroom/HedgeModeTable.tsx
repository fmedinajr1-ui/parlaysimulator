import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { WarRoomPropData } from './WarRoomPropCard';
import { calculateLineMispricing, type LineValueClass } from '@/lib/liveMispricedLineScanner';
import { getHedgeActionLabel, type HedgeActionLabel } from '@/lib/hedgeStatusUtils';

const BOOK_SHORT: Record<string, string> = {
  hardrockbet: 'HR', fanduel: 'FD', draftkings: 'DK',
  betmgm: 'MGM', caesars: 'CZR', pointsbet: 'PB',
};

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

function actionPill(suggestion: HedgeActionLabel) {
  const styles: Record<HedgeActionLabel, string> = {
    LOCK: 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))] border-[hsl(var(--warroom-green)/0.3)]',
    HOLD: 'bg-[hsl(var(--warroom-green)/0.1)] text-[hsl(var(--warroom-green)/0.8)] border-[hsl(var(--warroom-green)/0.2)]',
    MONITOR: 'bg-[hsl(var(--warroom-gold)/0.15)] text-[hsl(var(--warroom-gold))] border-[hsl(var(--warroom-gold)/0.3)]',
    'HEDGE ALERT': 'bg-[hsl(35,90%,55%)/0.15] text-[hsl(35,90%,55%)] border-[hsl(35,90%,55%)/0.3]',
    'HEDGE NOW': 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))] border-[hsl(var(--warroom-danger)/0.3)]',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border', styles[suggestion])}>
      {suggestion}
    </span>
  );
}

function valuePill(classification: LineValueClass) {
  const styles: Record<LineValueClass, string> = {
    SOFT: 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))] border-[hsl(var(--warroom-green)/0.3)]',
    SHARP: 'bg-[hsl(var(--warroom-card-border)/0.3)] text-foreground border-[hsl(var(--warroom-card-border))]',
    STALE: 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))] border-[hsl(var(--warroom-danger)/0.3)]',
  };
  return (
    <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold border cursor-help', styles[classification])}>
      {classification}
    </span>
  );
}

export function HedgeModeTable({ props }: HedgeModeTableProps) {
  const mispricingMap = useMemo(() => calculateLineMispricing(props), [props]);

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
                <HelpTip tip="Line value: SOFT (mispriced in your favor), SHARP (correctly priced), STALE (moved against you). Based on L10 avg, pace, projection, and line drift.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Value</span>
                </HelpTip>
              </th>
              <th className="text-right font-medium p-2">
                <HelpTip tip="Suggested action: LOCK (strong hold), HOLD (on pace), MONITOR (close), HEDGE (bet the opposite side to protect).">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Action</span>
                </HelpTip>
              </th>
              <th className="text-left font-medium p-2">
                <HelpTip tip="When action is HEDGE, this shows the specific counter-bet and best book to place it at.">
                  <span className="cursor-help border-b border-dotted border-muted-foreground/30">Hedge</span>
                </HelpTip>
              </th>
            </tr>
          </thead>
          <tbody>
            {props.map((p, i) => {
              const mispricing = mispricingMap.get(p.id);
              const betSide = (p.side || 'OVER').toUpperCase();
              const isOver = betSide !== 'UNDER';
              const edge = isOver
                ? p.projectedFinal - p.line
                : p.line - p.projectedFinal;
              const hedgeSuggestion = getHedgeActionLabel({
                currentValue: p.currentValue,
                projectedFinal: p.projectedFinal,
                line: p.line,
                side: betSide,
                gameProgress: p.gameProgress,
                paceRating: p.paceRating,
                confidence: p.confidence,
              });
              const pct = heats[i];

              // Hedge is always the OPPOSITE of the bet side
              const hedgeSide = isOver ? 'UNDER' : 'OVER';
              let hedgeLine = p.line;
              let hedgeBook = '';
              if (hedgeSuggestion === 'HEDGE NOW' && p.allBookLines && p.allBookLines.length > 0) {
                if (hedgeSide === 'UNDER') {
                  const best = p.allBookLines.reduce((a: any, b: any) => a.line > b.line ? a : b);
                  hedgeLine = best.line;
                  hedgeBook = BOOK_SHORT[best.bookmaker] || best.bookmaker;
                } else {
                  const best = p.allBookLines.reduce((a: any, b: any) => a.line < b.line ? a : b);
                  hedgeLine = best.line;
                  hedgeBook = BOOK_SHORT[best.bookmaker] || best.bookmaker;
                }
              }

              return (
                <motion.tr
                  key={p.id}
                  layout
                  className="border-b border-[hsl(var(--warroom-card-border)/0.5)] hover:bg-[hsl(var(--warroom-card-border)/0.3)]"
                >
                  <td className="p-2">
                    <span className="font-medium text-foreground">{p.playerName}</span>
                    <span className="text-muted-foreground ml-1">
                      {PROP_SHORT[p.propType] || p.propType} {isOver ? 'O' : 'U'}
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
                    {mispricing ? (
                      <HelpTip tip={`L10 edge: ${mispricing.l10Edge >= 0 ? '+' : ''}${mispricing.l10Edge.toFixed(1)} | Pace adj: ${mispricing.paceAdj.toFixed(2)}x | Proj edge: ${mispricing.projEdge >= 0 ? '+' : ''}${mispricing.projEdge.toFixed(1)} | Line drift: ${mispricing.lineDrift >= 0 ? '+' : ''}${mispricing.lineDrift.toFixed(1)}`}>
                        {valuePill(mispricing.classification)}
                      </HelpTip>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-right p-2">
                    {actionPill(hedgeSuggestion)}
                  </td>
                  <td className="p-2 text-left">
                    {(hedgeSuggestion === 'HEDGE NOW' || hedgeSuggestion === 'HEDGE ALERT') ? (
                      <span className="text-[10px] font-bold text-[hsl(var(--warroom-danger))]">
                        {hedgeSide} {hedgeLine}
                        {hedgeBook && (
                          <span className="text-muted-foreground font-normal ml-1">@ {hedgeBook}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
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
