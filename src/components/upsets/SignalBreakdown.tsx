import { motion } from 'framer-motion';
import { Check, X, TrendingUp, Activity, Home, Calendar, Dices, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GodModeSignal } from '@/types/god-mode';

interface SignalBreakdownProps {
  signals: GodModeSignal[];
  className?: string;
  compact?: boolean;
}

const signalIcons: Record<string, React.ReactNode> = {
  'Sharp Money': <DollarSign className="h-4 w-4" />,
  'CHESS EV': <Activity className="h-4 w-4" />,
  'Upset Value': <TrendingUp className="h-4 w-4" />,
  'Home Court': <Home className="h-4 w-4" />,
  'Day Pattern': <Calendar className="h-4 w-4" />,
  'Monte Carlo': <Dices className="h-4 w-4" />
};

export function SignalBreakdown({ signals, className, compact = false }: SignalBreakdownProps) {
  const sortedSignals = [...signals].sort((a, b) => b.contribution - a.contribution);
  const totalContribution = signals.reduce((sum, s) => sum + s.contribution, 0);

  if (compact) {
    return (
      <div className={cn('flex flex-wrap gap-1', className)}>
        {sortedSignals.map((signal) => (
          <div
            key={signal.name}
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              signal.isActive
                ? 'bg-chart-2/20 text-chart-2'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {signal.isActive ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {signal.name.split(' ')[0]}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Signal Breakdown</h4>
        <span className="text-xs text-muted-foreground">
          {signals.filter(s => s.isActive).length}/{signals.length} active
        </span>
      </div>

      <div className="space-y-2">
        {sortedSignals.map((signal, index) => {
          const contributionPct = totalContribution > 0 
            ? (signal.contribution / totalContribution * 100) 
            : 0;

          return (
            <motion.div
              key={signal.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    'rounded-full p-1',
                    signal.isActive ? 'bg-chart-2/20 text-chart-2' : 'bg-muted text-muted-foreground'
                  )}>
                    {signalIcons[signal.name]}
                  </div>
                  <span className={cn(
                    'font-medium',
                    signal.isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {signal.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({Math.round(signal.weight * 100)}%)
                  </span>
                </div>
                <span className={cn(
                  'font-semibold',
                  signal.isActive ? 'text-chart-2' : 'text-muted-foreground'
                )}>
                  {Math.round(signal.value)}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <motion.div
                  className={cn(
                    'h-full rounded-full',
                    signal.isActive 
                      ? 'bg-gradient-to-r from-chart-2 to-chart-1' 
                      : 'bg-muted-foreground/30'
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${signal.value}%` }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                />
              </div>

              <p className="text-xs text-muted-foreground">{signal.description}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
