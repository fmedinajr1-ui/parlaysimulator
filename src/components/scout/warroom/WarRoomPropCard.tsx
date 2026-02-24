import React from 'react';
import { motion } from 'framer-motion';
import { Snowflake, Flame, Zap, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FatigueRing } from './FatigueRing';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { RegressionAlert } from '@/hooks/useRegressionDetection';

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

export function WarRoomPropCard({ data }: { data: WarRoomPropData }) {
  const {
    playerName, propType, line, side, currentValue,
    projectedFinal, confidence, paceRating, fatiguePercent,
    regression, hasHedgeOpportunity, hitRateL10,
    pOver, pUnder, edgeScore, minutesStabilityIndex, foulRisk, paceMult,
  } = data;

  const progressPct = line > 0 ? Math.min((currentValue / line) * 100, 150) : 0;
  const paceAdj = paceRating ? Math.round(paceRating - 100) : 0;
  const isOnTrack = projectedFinal >= line && side === 'OVER';
  const hasEdge = edgeScore !== undefined && edgeScore !== 0;
  const paceMultVal = paceMult ?? 1.0;

  // Determine card glow class
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
      className={cn(
        'warroom-card p-3 space-y-2 transition-all',
        glowClass
      )}
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
            <HelpTip tip="Probability this player reverts to their average. Cold = due for a dip, Hot = due to cool off.">
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
                {regression.direction === 'cold' ? (
                  <Snowflake className="w-3 h-3" />
                ) : (
                  <Flame className="w-3 h-3" />
                )}
                {Math.round(regression.probability * 100)}%
              </motion.div>
            </HelpTip>
          )}
          {hasHedgeOpportunity && (
            <HelpTip tip="A hedge opportunity is available for this prop. Check the alerts panel.">
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="cursor-help"
              >
                <Zap className="w-4 h-4 text-[hsl(var(--warroom-gold))]" />
              </motion.div>
            </HelpTip>
          )}
        </div>
      </div>

      {/* Win probability — show only the relevant side */}
      {pOver !== undefined && pUnder !== undefined && (() => {
        const winProb = side === 'OVER' ? pOver : pUnder;
        const winPct = Math.round(winProb * 100);
        return (
          <div className="flex items-center gap-1 text-[10px]">
            <HelpTip tip="Model's estimated chance this pick wins based on live game flow and projections.">
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
          <span className="text-muted-foreground">
            {currentValue} / {line}
          </span>
          <HelpTip tip="AI projection of the player's final stat line based on current pace and game context.">
            <span className={cn(
              'font-bold cursor-help border-b border-dotted border-muted-foreground/30',
              isOnTrack ? 'text-[hsl(var(--warroom-green))]' : 'text-muted-foreground'
            )}>
              Proj: {projectedFinal.toFixed(1)}
            </span>
          </HelpTip>
        </div>
        <Progress
          value={Math.min(progressPct, 100)}
          className="h-1.5 bg-[hsl(var(--warroom-card-border))]"
        />
      </div>


      {/* Bottom metrics row */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <HelpTip tip="How fast this game is being played compared to league average. Positive = more possessions = more stats.">
          <span className="cursor-help border-b border-dotted border-muted-foreground/30">
            Pace: <span className={paceAdj > 0 ? 'text-[hsl(var(--warroom-green))]' : paceAdj < -3 ? 'text-[hsl(var(--warroom-danger))]' : ''}>
              {paceAdj >= 0 ? '+' : ''}{paceAdj}%
            </span>
          </span>
        </HelpTip>
        <HelpTip tip="Overall confidence score combining pace, matchup, fatigue, and regression factors.">
          <span className="flex items-center gap-0.5 cursor-help border-b border-dotted border-muted-foreground/30">
            <TrendingUp className="w-3 h-3" />
            AI: <span className="font-bold text-foreground">{confidence}%</span>
          </span>
        </HelpTip>
        <HelpTip tip="How often this player has cleared this line in their last 10 games.">
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
