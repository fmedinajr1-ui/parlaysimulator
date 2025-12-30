import React from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlayerStatProgressProps {
  playerName: string;
  currentValue: number;
  line: number;
  statType: string;
  gameProgress: number; // 0-100
  className?: string;
}

export function PlayerStatProgress({
  playerName,
  currentValue,
  line,
  statType,
  gameProgress,
  className,
}: PlayerStatProgressProps) {
  const progress = Math.min((currentValue / line) * 100, 150);
  const isHitting = currentValue >= line;
  const isOnPace = gameProgress > 0 ? (currentValue / (gameProgress / 100)) >= line : false;
  const projectedFinal = gameProgress > 0 ? Math.round(currentValue / (gameProgress / 100)) : currentValue;
  
  // Determine trend
  const pacePercentage = gameProgress > 0 ? (currentValue / (line * (gameProgress / 100))) * 100 : 100;
  const trend = pacePercentage > 110 ? 'up' : pacePercentage < 90 ? 'down' : 'neutral';

  return (
    <div className={cn('p-3 rounded-lg bg-muted/50', className)}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-medium text-sm">{playerName}</p>
          <p className="text-xs text-muted-foreground">{statType}</p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1">
            <span className={cn(
              'text-lg font-bold tabular-nums',
              isHitting ? 'text-chart-2' : 'text-foreground'
            )}>
              {currentValue}
            </span>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-muted-foreground">{line}</span>
          </div>
          <div className="flex items-center gap-1 justify-end">
            {trend === 'up' && <TrendingUp className="w-3 h-3 text-chart-2" />}
            {trend === 'down' && <TrendingDown className="w-3 h-3 text-destructive" />}
            {trend === 'neutral' && <Minus className="w-3 h-3 text-muted-foreground" />}
            <span className={cn(
              'text-xs',
              isOnPace ? 'text-chart-2' : 'text-muted-foreground'
            )}>
              {isOnPace ? 'On Pace' : 'Behind'}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className={cn(
            'absolute left-0 top-0 h-full rounded-full',
            isHitting ? 'bg-chart-2' : progress >= 75 ? 'bg-chart-4' : 'bg-primary'
          )}
        />
        {/* Line marker */}
        <div 
          className="absolute top-0 w-0.5 h-full bg-foreground/50"
          style={{ left: `${Math.min((line / (line * 1.5)) * 100, 100)}%` }}
        />
      </div>

      {/* Projection */}
      {gameProgress > 0 && gameProgress < 100 && (
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-muted-foreground">
            {Math.round(gameProgress)}% of game
          </span>
          <span className={cn(
            'font-medium',
            projectedFinal >= line ? 'text-chart-2' : 'text-muted-foreground'
          )}>
            Proj: {projectedFinal}
          </span>
        </div>
      )}
    </div>
  );
}