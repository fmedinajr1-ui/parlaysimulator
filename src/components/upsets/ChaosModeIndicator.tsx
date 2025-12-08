import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertTriangle, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChaosModeIndicatorProps {
  chaosPercentage: number;
  isActive: boolean;
  variant?: 'banner' | 'badge' | 'compact';
  className?: string;
}

export function ChaosModeIndicator({
  chaosPercentage,
  isActive,
  variant = 'badge',
  className
}: ChaosModeIndicatorProps) {
  if (!isActive && variant !== 'banner') return null;

  if (variant === 'banner') {
    return (
      <AnimatePresence>
        {isActive && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              'relative overflow-hidden rounded-lg bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500 p-4',
              className
            )}
          >
            {/* Animated background */}
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            />

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                >
                  <Zap className="h-6 w-6 text-white" />
                </motion.div>
                
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    🌀 GOD MODE: CHAOS ACTIVE
                    <motion.span
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="text-yellow-300"
                    >
                      ⚡
                    </motion.span>
                  </h3>
                  <p className="text-sm text-white/80">
                    High volatility detected • +15% underdog probability boost active
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="text-2xl font-bold text-white">
                  {Math.round(chaosPercentage)}%
                </div>
                <div className="text-xs text-white/70">Chaos Level</div>
              </div>
            </div>

            {/* Chaos indicators */}
            <div className="relative mt-3 flex gap-2">
              {['Market Volatility', 'Sharp Divergence', 'Pattern Break'].map((indicator, i) => (
                <motion.div
                  key={indicator}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white"
                >
                  {indicator}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (variant === 'compact') {
    return (
      <motion.div
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-2 py-0.5 text-xs font-bold text-white',
          className
        )}
      >
        <Zap className="h-3 w-3" />
        CHAOS
      </motion.div>
    );
  }

  // Default badge variant
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'relative overflow-hidden rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 p-3',
        className
      )}
    >
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        animate={{ x: ['-100%', '100%'] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
      />

      <div className="relative flex items-center gap-2">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
        >
          <AlertTriangle className="h-5 w-5 text-yellow-300" />
        </motion.div>

        <div>
          <div className="flex items-center gap-1 text-sm font-bold text-white">
            🌀 CHAOS MODE
          </div>
          <div className="flex items-center gap-1 text-xs text-white/80">
            <TrendingUp className="h-3 w-3" />
            +15% boost
          </div>
        </div>

        <div className="ml-auto text-lg font-bold text-white">
          {Math.round(chaosPercentage)}%
        </div>
      </div>
    </motion.div>
  );
}
