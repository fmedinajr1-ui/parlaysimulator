import { motion, AnimatePresence } from 'framer-motion';
import { Clock, X, AlertCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ExtractionQueueBannerProps {
  isVisible: boolean;
  queuePosition?: number;
  estimatedWaitSeconds?: number;
  isRateLimited?: boolean;
  retryingCount?: number;
  processingCount?: number;
  completedCount?: number;
  totalCount?: number;
  message?: string;
  onCancel?: () => void;
}

export function ExtractionQueueBanner({
  isVisible,
  queuePosition = 0,
  estimatedWaitSeconds = 0,
  isRateLimited = false,
  retryingCount = 0,
  processingCount = 0,
  completedCount = 0,
  totalCount = 0,
  message,
  onCancel,
}: ExtractionQueueBannerProps) {
  if (!isVisible) return null;

  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const isRetrying = retryingCount > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -20, height: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "rounded-lg border p-4 mb-4",
          isRateLimited 
            ? "bg-amber-500/10 border-amber-500/30" 
            : isRetrying
              ? "bg-orange-500/10 border-orange-500/30"
              : "bg-primary/5 border-primary/20"
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2">
              {isRateLimited ? (
                <>
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                  <span className="font-medium text-amber-500">High Demand</span>
                </>
              ) : isRetrying ? (
                <>
                  <RefreshCw className="h-5 w-5 text-orange-500 animate-spin" />
                  <span className="font-medium text-orange-500">Retrying...</span>
                </>
              ) : processingCount > 0 ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Clock className="h-5 w-5 text-primary" />
                  </motion.div>
                  <span className="font-medium text-primary">Processing</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="font-medium text-green-500">Complete</span>
                </>
              )}
            </div>

            {/* Status message */}
            <div className="space-y-1">
              {message ? (
                <p className="text-sm text-muted-foreground">{message}</p>
              ) : isRateLimited ? (
                <p className="text-sm text-muted-foreground">
                  You're #{queuePosition} in queue. Estimated wait: ~{estimatedWaitSeconds}s
                </p>
              ) : processingCount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Processing {processingCount} of {totalCount} image{totalCount !== 1 ? 's' : ''}...
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {completedCount} of {totalCount} completed
                </p>
              )}
            </div>

            {/* Progress bar */}
            {totalCount > 0 && (
              <div className="space-y-1">
                <Progress 
                  value={progress} 
                  className={cn(
                    "h-2",
                    isRateLimited && "[&>div]:bg-amber-500",
                    isRetrying && "[&>div]:bg-orange-500"
                  )}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{completedCount} completed</span>
                  {retryingCount > 0 && (
                    <span className="text-orange-500">{retryingCount} retrying</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cancel button */}
          {onCancel && (processingCount > 0 || queuePosition > 0 || isRateLimited) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="shrink-0"
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
