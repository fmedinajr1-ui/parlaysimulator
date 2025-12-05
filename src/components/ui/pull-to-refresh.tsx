import { RefreshCw, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PullToRefreshIndicatorProps {
  pullProgress: number;
  isRefreshing: boolean;
  threshold?: number;
}

export function PullToRefreshIndicator({ 
  pullProgress, 
  isRefreshing,
  threshold = 80 
}: PullToRefreshIndicatorProps) {
  const progress = Math.min(pullProgress / threshold, 1);
  const shouldTrigger = pullProgress >= threshold;
  
  if (pullProgress === 0 && !isRefreshing) return null;
  
  return (
    <div 
      className="flex items-center justify-center overflow-hidden transition-all duration-200"
      style={{ 
        height: isRefreshing ? threshold : pullProgress,
        opacity: Math.min(progress * 1.5, 1)
      }}
    >
      <div className={cn(
        "flex flex-col items-center gap-2 transition-all duration-200",
        shouldTrigger || isRefreshing ? "scale-100" : "scale-75"
      )}>
        <div className={cn(
          "w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center",
          isRefreshing && "animate-pulse"
        )}>
          {isRefreshing ? (
            <RefreshCw className="w-5 h-5 text-primary animate-spin" />
          ) : shouldTrigger ? (
            <RefreshCw 
              className="w-5 h-5 text-primary transition-transform" 
              style={{ transform: `rotate(${progress * 180}deg)` }}
            />
          ) : (
            <ArrowDown 
              className="w-5 h-5 text-muted-foreground transition-transform"
              style={{ transform: `rotate(${progress * 180}deg)` }}
            />
          )}
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {isRefreshing 
            ? "Refreshing..." 
            : shouldTrigger 
              ? "Release to refresh" 
              : "Pull to refresh"
          }
        </span>
      </div>
    </div>
  );
}

interface PullToRefreshContainerProps {
  children: React.ReactNode;
  pullProgress: number;
  isRefreshing: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  className?: string;
  threshold?: number;
}

export function PullToRefreshContainer({
  children,
  pullProgress,
  isRefreshing,
  containerRef,
  handlers,
  className,
  threshold = 80,
}: PullToRefreshContainerProps) {
  return (
    <div
      ref={containerRef}
      className={cn("overflow-auto overscroll-none", className)}
      onTouchStart={handlers.onTouchStart}
      onTouchMove={handlers.onTouchMove}
      onTouchEnd={handlers.onTouchEnd}
    >
      <PullToRefreshIndicator 
        pullProgress={pullProgress} 
        isRefreshing={isRefreshing}
        threshold={threshold}
      />
      <div 
        className="transition-transform duration-200"
        style={{ 
          transform: pullProgress > 0 && !isRefreshing 
            ? `translateY(${Math.min(pullProgress * 0.3, 20)}px)` 
            : undefined 
        }}
      >
        {children}
      </div>
    </div>
  );
}
