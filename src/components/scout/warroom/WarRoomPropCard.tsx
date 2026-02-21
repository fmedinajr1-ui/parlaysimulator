import React from 'react';
import { motion } from 'framer-motion';
import { Snowflake, Flame, Zap, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FatigueRing } from './FatigueRing';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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
}

const PROP_SHORT: Record<string, string> = {
  points: 'PTS', assists: 'AST', threes: '3PT',
  rebounds: 'REB', blocks: 'BLK', steals: 'STL',
};

export function WarRoomPropCard({ data }: { data: WarRoomPropData }) {
  const {
    playerName, propType, line, side, currentValue,
    projectedFinal, confidence, paceRating, fatiguePercent,
    regression, hasHedgeOpportunity, hitRateL10,
  } = data;

  const progressPct = line > 0 ? Math.min((currentValue / line) * 100, 150) : 0;
  const paceAdj = paceRating ? Math.round(paceRating - 100) : 0;
  const isOnTrack = projectedFinal >= line && side === 'OVER';

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

        {/* Regression badge */}
        <div className="flex items-center gap-1 shrink-0">
          {regression && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold',
                regression.direction === 'cold'
                  ? 'bg-[hsl(var(--warroom-ice)/0.15)] text-[hsl(var(--warroom-ice))]'
                  : 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))]'
              )}
              title={regression.tooltip}
            >
              {regression.direction === 'cold' ? (
                <Snowflake className="w-3 h-3" />
              ) : (
                <Flame className="w-3 h-3" />
              )}
              {Math.round(regression.probability * 100)}%
            </motion.div>
          )}
          {hasHedgeOpportunity && (
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <Zap className="w-4 h-4 text-[hsl(var(--warroom-gold))]" />
            </motion.div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">
            {currentValue} / {line}
          </span>
          <span className={cn(
            'font-bold',
            isOnTrack ? 'text-[hsl(var(--warroom-green))]' : 'text-muted-foreground'
          )}>
            Proj: {projectedFinal.toFixed(1)}
          </span>
        </div>
        <Progress
          value={Math.min(progressPct, 100)}
          className="h-1.5 bg-[hsl(var(--warroom-card-border))]"
        />
      </div>

      {/* Bottom metrics row */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Pace: <span className={paceAdj > 0 ? 'text-[hsl(var(--warroom-green))]' : paceAdj < -3 ? 'text-[hsl(var(--warroom-danger))]' : ''}>
            {paceAdj >= 0 ? '+' : ''}{paceAdj}%
          </span>
        </span>
        <span className="flex items-center gap-0.5">
          <TrendingUp className="w-3 h-3" />
          AI: <span className="font-bold text-foreground">{confidence}%</span>
        </span>
        <span>
          L10: <span className={cn(
            'font-bold',
            hitRateL10 >= 0.8 ? 'text-[hsl(var(--warroom-green))]' : hitRateL10 >= 0.6 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]'
          )}>
            {Math.round(hitRateL10 * 100)}%
          </span>
        </span>
      </div>
    </motion.div>
  );
}
