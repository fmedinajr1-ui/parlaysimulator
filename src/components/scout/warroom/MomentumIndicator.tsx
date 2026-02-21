import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MomentumIndicatorProps {
  homeScore: number;
  awayScore: number;
  /** 'home' | 'away' | 'tied' */
  className?: string;
}

export function MomentumIndicator({ homeScore, awayScore, className }: MomentumIndicatorProps) {
  const diff = homeScore - awayScore;
  const direction = diff > 0 ? 'home' : diff < 0 ? 'away' : 'tied';
  const absDiff = Math.abs(diff);

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={direction}
          initial={{ scale: 1.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="flex items-center gap-0.5"
        >
          {direction === 'home' && (
            <TrendingUp
              className={cn(
                'w-3.5 h-3.5',
                absDiff >= 15 ? 'text-[hsl(var(--warroom-green))]' : 'text-[hsl(var(--warroom-green)/0.7)]'
              )}
            />
          )}
          {direction === 'away' && (
            <TrendingDown
              className={cn(
                'w-3.5 h-3.5',
                absDiff >= 15 ? 'text-[hsl(var(--warroom-danger))]' : 'text-[hsl(var(--warroom-danger)/0.7)]'
              )}
            />
          )}
          {direction === 'tied' && (
            <Minus className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </motion.div>
      </AnimatePresence>
      {absDiff > 0 && (
        <span className="text-[10px] tabular-nums text-muted-foreground font-medium">
          {absDiff > 0 ? `+${absDiff}` : ''}
        </span>
      )}
    </div>
  );
}
