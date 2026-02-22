import React from 'react';
import { motion } from 'framer-motion';
import { Snowflake, Flame, Zap, TrendingUp, Shield, Activity } from 'lucide-react';
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
  // v6: Intelligence fields
  pOver?: number;
  pUnder?: number;
  edgeScore?: number;
  minutesStabilityIndex?: number;
  foulRisk?: 'low' | 'medium' | 'high';
  paceMult?: number;
}

const PROP_SHORT: Record<string, string> = {
  points: 'PTS', assists: 'AST', threes: '3PT',
  rebounds: 'REB', blocks: 'BLK', steals: 'STL',
};

const FOUL_COLORS: Record<string, string> = {
  low: 'text-[hsl(var(--warroom-green))]',
  medium: 'text-[hsl(var(--warroom-gold))]',
  high: 'text-[hsl(var(--warroom-danger))]',
};

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
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                'px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums',
                edgeScore! > 5 ? 'bg-[hsl(var(--warroom-green)/0.15)] text-[hsl(var(--warroom-green))]'
                  : edgeScore! > 0 ? 'bg-[hsl(var(--warroom-gold)/0.15)] text-[hsl(var(--warroom-gold))]'
                  : 'bg-[hsl(var(--warroom-danger)/0.15)] text-[hsl(var(--warroom-danger))]'
              )}
            >
              {edgeScore! > 0 ? '+' : ''}{edgeScore!.toFixed(1)}%
            </motion.div>
          )}
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

      {/* P_over / P_under row */}
      {pOver !== undefined && pUnder !== undefined && (
        <div className="flex items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">P(O):</span>
            <span className={cn('font-bold tabular-nums', pOver > 0.55 ? 'text-[hsl(var(--warroom-green))]' : 'text-muted-foreground')}>
              {(pOver * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">P(U):</span>
            <span className={cn('font-bold tabular-nums', pUnder > 0.55 ? 'text-[hsl(var(--warroom-danger))]' : 'text-muted-foreground')}>
              {(pUnder * 100).toFixed(1)}%
            </span>
          </div>
          {foulRisk && (
            <div className="flex items-center gap-0.5 ml-auto">
              <Shield className="w-3 h-3 text-muted-foreground" />
              <span className={cn('font-bold uppercase', FOUL_COLORS[foulRisk])}>
                {foulRisk}
              </span>
            </div>
          )}
        </div>
      )}

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

      {/* Pace Meter — animated bar showing pace_mult relative to 1.0 */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <Activity className="w-3 h-3" />
            Pace
          </span>
          <span className={cn(
            'font-bold tabular-nums',
            paceMultVal > 1.02 ? 'text-[hsl(var(--warroom-green))]' : paceMultVal < 0.98 ? 'text-[hsl(var(--warroom-danger))]' : 'text-muted-foreground'
          )}>
            {paceMultVal.toFixed(2)}x
          </span>
        </div>
        <div className="h-1 rounded-full bg-[hsl(var(--warroom-card-border))] overflow-hidden relative">
          {/* Center marker at 50% (= 1.0x pace) */}
          <div className="absolute left-1/2 top-0 w-px h-full bg-muted-foreground/30" />
          <motion.div
            className="h-full rounded-full"
            style={{
              background: paceMultVal > 1.02 ? 'hsl(var(--warroom-green))' : paceMultVal < 0.98 ? 'hsl(var(--warroom-danger))' : 'hsl(var(--warroom-gold))',
              width: `${Math.min(100, Math.max(5, paceMultVal * 50))}%`,
            }}
            initial={{ width: '50%' }}
            animate={{ width: `${Math.min(100, Math.max(5, paceMultVal * 50))}%` }}
            transition={{ duration: 0.6 }}
          />
        </div>
      </div>

      {/* Minutes Stability Bar */}
      {minutesStabilityIndex !== undefined && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[9px] text-muted-foreground">
            <span>Min Stability</span>
            <span className={cn(
              'font-bold tabular-nums',
              minutesStabilityIndex >= 75 ? 'text-[hsl(var(--warroom-green))]' : minutesStabilityIndex >= 50 ? 'text-[hsl(var(--warroom-gold))]' : 'text-[hsl(var(--warroom-danger))]'
            )}>
              {minutesStabilityIndex}
            </span>
          </div>
          <div className="h-1 rounded-full bg-[hsl(var(--warroom-card-border))] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: minutesStabilityIndex >= 75 ? 'hsl(var(--warroom-green))' : minutesStabilityIndex >= 50 ? 'hsl(var(--warroom-gold))' : 'hsl(var(--warroom-danger))',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${minutesStabilityIndex}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>
      )}

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
