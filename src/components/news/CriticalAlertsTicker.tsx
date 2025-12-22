import React from 'react';
import { useCriticalAlerts } from '@/hooks/useCriticalAlerts';
import { AlertTriangle, TrendingUp, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

const getAlertIcon = (newsType: string) => {
  switch (newsType) {
    case 'injury':
      return <AlertTriangle className="w-3 h-3 text-destructive" />;
    case 'sharp_action':
      return <TrendingUp className="w-3 h-3 text-chart-2" />;
    case 'market_move':
      return <Activity className="w-3 h-3 text-chart-3" />;
    default:
      return <Activity className="w-3 h-3" />;
  }
};

export function CriticalAlertsTicker() {
  const { alerts, isLoading, isConnected } = useCriticalAlerts();

  if (isLoading) {
    return (
      <div className="h-10 bg-card/50 border-b border-border/50 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="relative h-10 bg-card/80 backdrop-blur-sm border-b border-border/50 overflow-hidden">
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center gap-1.5 px-3 bg-gradient-to-r from-card via-card to-transparent">
        <span className="relative flex h-2 w-2">
          <span className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            isConnected ? "bg-destructive" : "bg-muted-foreground"
          )} />
          <span className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isConnected ? "bg-destructive" : "bg-muted-foreground"
          )} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Live
        </span>
      </div>

      {/* Scrolling content */}
      <div className="ticker-wrapper h-full flex items-center pl-16">
        <div className="ticker-content flex items-center gap-6 whitespace-nowrap">
          {/* Duplicate alerts for seamless loop */}
          {[...alerts, ...alerts].map((alert, index) => (
            <div
              key={`${alert.id}-${index}`}
              className="flex items-center gap-2 text-sm"
            >
              {getAlertIcon(alert.news_type)}
              <span className="text-foreground/90 font-medium">
                {alert.headline}
              </span>
              <span className="text-muted-foreground text-xs">
                {alert.home_team} vs {alert.away_team}
              </span>
              <span className="text-border">•</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right fade */}
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-card to-transparent pointer-events-none" />

      {/* Ticker animation styles */}
      <style>{`
        .ticker-wrapper {
          mask-image: linear-gradient(to right, transparent, black 60px, black calc(100% - 48px), transparent);
        }
        
        .ticker-content {
          animation: ticker-scroll 40s linear infinite;
        }
        
        .ticker-content:hover {
          animation-play-state: paused;
        }
        
        @keyframes ticker-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
