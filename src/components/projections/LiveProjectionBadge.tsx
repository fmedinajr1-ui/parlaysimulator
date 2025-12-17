import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Radio, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectionUpdate } from '@/hooks/useRealtimeProjections';
import { formatDistanceToNow } from 'date-fns';

interface LiveProjectionBadgeProps {
  update?: ProjectionUpdate | null;
  showProbability?: boolean;
  compact?: boolean;
  className?: string;
}

export const LiveProjectionBadge = ({
  update,
  showProbability = true,
  compact = false,
  className,
}: LiveProjectionBadgeProps) => {
  if (!update) {
    return null;
  }

  const isPositive = update.changePercent > 0;
  const isSignificant = update.isSignificant;
  const timeAgo = formatDistanceToNow(update.createdAt, { addSuffix: true });

  const probChange = update.newProbability && update.previousProbability
    ? (update.newProbability - update.previousProbability) * 100
    : null;

  if (compact) {
    return (
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
          isPositive
            ? "bg-green-500/20 text-green-400"
            : "bg-red-500/20 text-red-400",
          className
        )}
      >
        {isPositive ? (
          <TrendingUp className="h-2.5 w-2.5" />
        ) : (
          <TrendingDown className="h-2.5 w-2.5" />
        )}
        <span>{isPositive ? '+' : ''}{update.changePercent.toFixed(1)}%</span>
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        className={cn(
          "flex items-center gap-2 p-2 rounded-lg border",
          isSignificant
            ? isPositive
              ? "bg-green-500/10 border-green-500/30"
              : "bg-red-500/10 border-red-500/30"
            : "bg-muted/30 border-border/50",
          className
        )}
      >
        {/* Live indicator */}
        <div className="flex items-center gap-1">
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Radio className={cn(
              "h-3 w-3",
              isSignificant ? "text-green-400" : "text-muted-foreground"
            )} />
          </motion.div>
        </div>

        {/* Change indicator */}
        <div className="flex items-center gap-1">
          {isPositive ? (
            <TrendingUp className="h-4 w-4 text-green-400" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-400" />
          )}
          <span className={cn(
            "text-sm font-semibold",
            isPositive ? "text-green-400" : "text-red-400"
          )}>
            {isPositive ? '+' : ''}{update.changePercent.toFixed(1)}%
          </span>
        </div>

        {/* Probability change */}
        {showProbability && probChange !== null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Hit:</span>
            <span className={cn(
              "font-medium",
              probChange > 0 ? "text-green-400" : "text-red-400"
            )}>
              {Math.round(update.previousProbability! * 100)}% → {Math.round(update.newProbability! * 100)}%
            </span>
          </div>
        )}

        {/* Time ago */}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {timeAgo}
        </span>
      </motion.div>
    </AnimatePresence>
  );
};

// Minimal version for inline use
export const LiveProjectionIndicator = ({
  update,
  className,
}: {
  update?: ProjectionUpdate | null;
  className?: string;
}) => {
  if (!update || !update.isSignificant) {
    return null;
  }

  const isPositive = update.changePercent > 0;

  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className={cn(
        "relative flex items-center justify-center",
        className
      )}
    >
      <motion.div
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className={cn(
          "absolute inset-0 rounded-full",
          isPositive ? "bg-green-500/20" : "bg-red-500/20"
        )}
      />
      {isPositive ? (
        <TrendingUp className="h-3 w-3 text-green-400 relative z-10" />
      ) : (
        <TrendingDown className="h-3 w-3 text-red-400 relative z-10" />
      )}
    </motion.div>
  );
};

// Loading spinner for refresh actions
export const ProjectionRefreshButton = ({
  isLoading,
  onClick,
  className,
}: {
  isLoading: boolean;
  onClick: () => void;
  className?: string;
}) => {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        "p-1.5 rounded-md hover:bg-muted/50 transition-colors",
        isLoading && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <RefreshCw className={cn(
        "h-4 w-4 text-muted-foreground",
        isLoading && "animate-spin"
      )} />
    </button>
  );
};
