import React from 'react';
import { motion } from 'framer-motion';
import { Snowflake, Flame, Zap, TrendingUp, Swords } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FatigueRing } from './FatigueRing';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { RegressionAlert } from '@/hooks/useRegressionDetection';

export interface QuarterAvgs {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

export interface H2HMatchup {
  avgStat: number;
  gamesPlayed: number;
  hitRateOver: number;
  hitRateUnder: number;
}

export interface WarRoomPropData {
  id: string;
  playerName: string;
  propType: string;
  line: number;
  side: string;
  currentValue: number;
  projectedFinal: number;
  confidence: number;
  paceRating: number;
  fatiguePercent: number;
  regression: RegressionAlert | null;
  hasHedgeOpportunity: boolean;
  hitRateL10: number;
  liveBookLine: number;
  allBookLines?: { line: number; bookmaker: string; overPrice?: number; underPrice?: number }[];
  // v6: Intelligence fields
  pOver?: number;
  pUnder?: number;
  edgeScore?: number;
  minutesStabilityIndex?: number;
  foulRisk?: 'low' | 'medium' | 'high';
  paceMult?: number;
  l10Avg?: number;
  gameProgress?: number;
  // v7: Quarter + H2H
  quarterAvgs?: QuarterAvgs;
  h2hVsOpponent?: H2HMatchup;
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

function QuarterBreakdown({ quarters, line }: { quarters: QuarterAvgs; line: number }) {
  const vals = [quarters.q1, quarters.q2, quarters.q3, quarters.q4];
  const peak = Math.max(...vals);
  const cumulative = [vals[0], vals[0] + vals[1], vals[0] + vals[1] + vals[2], vals[0] + vals[1] + vals[2] + vals[3]];

  return (
    <div className="grid grid-cols-4 gap-1 text-center">
      {(['Q1', 'Q2', 'Q3', 'Q4'] as const).map((label, i) => {
        const isPeak = vals[i] === peak && peak > 0;
        const hitsByQ = cumulative[i] >= line;
        return (
          <HelpTip key={label} tip={`${label}: ~${vals[i].toFixed(1)} avg. Cumulative by ${label}: ${cumulative[i].toFixed(1)}${hitsByQ ? ' ✓ hits line' : ''}`}>
            <div className={cn(
              'rounded px-1 py-0.5 text-[9px] font-mono cursor-help transition-colors',
              isPeak
                ? 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))] font-bold'
                : 'bg-muted/50 text-muted-foreground'
            )}>
              <div className="text-[8px] text-muted-foreground/70">{label}</div>
              <div>{vals[i].toFixed(1)}</div>
            </div>
          </HelpTip>
        );
      })}
    </div>
  );
}

function H2HRow({ h2h, line, side }: { h2h: H2HMatchup; line: number; side: string }) {
  const isAboveLine = h2h.avgStat >= line;
  const relevantHitRate = side === 'OVER' ? h2h.hitRateOver : h2h.hitRateUnder;
  const hitPct = Math.round(relevantHitRate * 100);

  return (
    <HelpTip tip={`Head-to-head: avg ${h2h.avgStat.toFixed(1)} in ${h2h.gamesPlayed} games vs this opponent. ${side} hit rate: ${hitPct}%`}>
      <div className="flex items-center gap-1.5 text-[10px] cursor-help">
        <Swords className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">H2H:</span>
        <span className={cn(
          'font-bold tabular-nums',
          isAboveLine ? 'text-[hsl(var(--warroom-green))]' : 'text-[hsl(var(--warroom-danger))]'
        )}>
          {h2h.avgStat.toFixed(1)}
        </span>
        <span className="text-muted-foreground/60">
          ({h2h.gamesPlayed}g)
        </span>
        <span className={cn(
          'ml-auto font-bold tabular-nums',
          hitPct >= 60 ? 'text-[hsl(var(--warroom-green))]' : hitPct >= 40 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]'
        )}>
          {hitPct}%
        </span>
      </div>
    </HelpTip>
  );
}

export function WarRoomPropCard({ data }: { data: WarRoomPropData }) {
  const {
    playerName, propType, line, side, currentValue,
    projectedFinal, confidence, paceRating, fatiguePercent,
    regression, hasHedgeOpportunity, hitRateL10,
    pOver, pUnder, edgeScore, quarterAvgs, h2hVsOpponent,
  } = data;

  const progressPct = line > 0 ? Math.min((currentValue / line) * 100, 150) : 0;
  const paceAdj = paceRating ? Math.round(paceRating - 100) : 0;
  const isOnTrack = projectedFinal >= line && side === 'OVER';
  const hasEdge = edgeScore !== undefined && edgeScore !== 0;

  const glowClass = hasHedgeOpportunity
    ? 'warroom-glow-gold'
    : regression?.direction === 'cold'
      ? 'warroom-glow-ice'
      : fatiguePercent > 75
        ? 'warroom-glow-danger'
        : '';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('warroom-card p-3 space-y-2 transition-all', glowClass)}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FatigueRing fatiguePercent={fatiguePercent} size={32} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{playerName}</p>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="text-[9px] px-1 py-0 border-[hsl(var(--warroom-card-border))]">
                {PROP_SHORT[propType] || propType.toUpperCase()}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                {side} {line}
              </span>
            </div>
          </div>
        </div>

        {/* Edge Score Badge + Regression */}
        <div className="flex items-center gap-1 shrink-0">
          {hasEdge && (
            <HelpTip tip="Your estimated advantage over the book's implied odds. Positive = value bet.">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums cursor-help',
                  edgeScore! > 5 ? 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))]'
                    : edgeScore! > 0 ? 'bg-[hsl(var(--warroom-gold)/0.15)] text-[hsl(var(--warroom-gold))]'
                    : 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))]'
                )}
              >
                {edgeScore! > 0 ? '+' : ''}{edgeScore!.toFixed(1)}%
              </motion.div>
            </HelpTip>
          )}
          {regression && (
            <HelpTip tip="Probability this player reverts to their average.">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={cn(
                  'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold cursor-help',
                  regression.direction === 'cold'
                    ? 'bg-[hsl(var(--warroom-ice)/0.15)] text-[hsl(var(--warroom-ice))]'
                    : 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))]'
                )}
              >
                {regression.direction === 'cold' ? <Snowflake className="w-3 h-3" /> : <Flame className="w-3 h-3" />}
                {Math.round(regression.probability * 100)}%
              </motion.div>
            </HelpTip>
          )}
          {hasHedgeOpportunity && (
            <HelpTip tip="A hedge opportunity is available for this prop.">
              <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="cursor-help">
                <Zap className="w-4 h-4 text-[hsl(var(--warroom-gold))]" />
              </motion.div>
            </HelpTip>
          )}
        </div>
      </div>

      {/* Win probability */}
      {pOver !== undefined && pUnder !== undefined && (() => {
        const winProb = side === 'OVER' ? pOver : pUnder;
        const winPct = Math.round(winProb * 100);
        return (
          <div className="flex items-center gap-1 text-[10px]">
            <HelpTip tip="Model's estimated chance this pick wins.">
              <span className="text-muted-foreground cursor-help border-b border-dotted border-muted-foreground/30">Win prob:</span>
            </HelpTip>
            <span className={cn(
              'font-bold tabular-nums',
              winPct >= 60 ? 'text-[hsl(var(--warroom-green))]' : winPct >= 50 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]'
            )}>
              {winPct}%
            </span>
          </div>
        );
      })()}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">{currentValue} / {line}</span>
          <HelpTip tip="AI projection of the player's final stat line.">
            <span className={cn(
              'font-bold cursor-help border-b border-dotted border-muted-foreground/30',
              isOnTrack ? 'text-[hsl(var(--warroom-green))]' : 'text-muted-foreground'
            )}>
              Proj: {projectedFinal.toFixed(1)}
            </span>
          </HelpTip>
        </div>
        <Progress value={Math.min(progressPct, 100)} className="h-1.5 bg-[hsl(var(--warroom-card-border))]" />
      </div>

      {/* Quarter Breakdown */}
      {quarterAvgs && <QuarterBreakdown quarters={quarterAvgs} line={line} />}

      {/* H2H Matchup */}
      {h2hVsOpponent && h2hVsOpponent.gamesPlayed > 0 && (
        <H2HRow h2h={h2hVsOpponent} line={line} side={side} />
      )}

      {/* Bottom metrics row */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <HelpTip tip="Game pace compared to league average.">
          <span className="cursor-help border-b border-dotted border-muted-foreground/30">
            Pace: <span className={paceAdj > 0 ? 'text-[hsl(var(--warroom-green))]' : paceAdj < -3 ? 'text-[hsl(var(--warroom-danger))]' : ''}>
              {paceAdj >= 0 ? '+' : ''}{paceAdj}%
            </span>
          </span>
        </HelpTip>
        <HelpTip tip="Overall AI confidence score.">
          <span className="flex items-center gap-0.5 cursor-help border-b border-dotted border-muted-foreground/30">
            <TrendingUp className="w-3 h-3" />
            AI: <span className="font-bold text-foreground">{confidence}%</span>
          </span>
        </HelpTip>
        <HelpTip tip="Hit rate in last 10 games.">
          <span className="cursor-help border-b border-dotted border-muted-foreground/30">
            L10: <span className={cn(
              'font-bold',
              hitRateL10 >= 0.8 ? 'text-[hsl(var(--warroom-green))]' : hitRateL10 >= 0.6 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]'
            )}>
              {Math.round(hitRateL10 * 100)}%
            </span>
          </span>
        </HelpTip>
      </div>
    </motion.div>
  );
}
