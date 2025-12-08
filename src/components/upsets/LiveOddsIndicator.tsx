import { motion } from 'framer-motion';
import { Radio, TrendingUp, TrendingDown, Minus, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface LiveOddsIndicatorProps {
  isLive: boolean;
  lastUpdate: string;
  direction: 'up' | 'down' | 'stable';
  previousOdds?: number;
  currentOdds: number;
  className?: string;
}

export function LiveOddsIndicator({
  isLive,
  lastUpdate,
  direction,
  previousOdds,
  currentOdds,
  className
}: LiveOddsIndicatorProps) {
  const getDirectionIcon = () => {
    switch (direction) {
      case 'up':
        return <TrendingUp className="h-3 w-3 text-destructive" />;
      case 'down':
        return <TrendingDown className="h-3 w-3 text-chart-2" />;
      default:
        return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
  };

  const getDirectionText = () => {
    if (!previousOdds) return '';
    const change = currentOdds - previousOdds;
    if (Math.abs(change) < 3) return '';
    return change > 0 ? `+${change}` : `${change}`;
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {isLive && (
        <motion.div
          className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5"
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <motion.div
            className="h-2 w-2 rounded-full bg-destructive"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ repeat: Infinity, duration: 1.5 }}
          />
          <span className="text-xs font-bold text-destructive">LIVE</span>
        </motion.div>
      )}

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {getDirectionIcon()}
        
        {previousOdds && direction !== 'stable' && (
          <motion.span
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              'font-medium',
              direction === 'up' ? 'text-destructive' : 'text-chart-2'
            )}
          >
            {getDirectionText()}
          </motion.span>
        )}

        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDistanceToNow(new Date(lastUpdate), { addSuffix: true })}
        </span>
      </div>

      {isLive && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
          className="text-chart-2"
        >
          <Radio className="h-3 w-3" />
        </motion.div>
      )}
    </div>
  );
}
