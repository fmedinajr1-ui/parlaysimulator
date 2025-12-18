import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, MinusCircle } from 'lucide-react';
import { SportsCoachingSignal, SPORT_ICONS, SportType } from '@/hooks/useSportsCoachingSignals';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface CoachingAlertBannerProps {
  signals: SportsCoachingSignal[];
  isLoading?: boolean;
  legCountBySport?: Record<SportType, number>;
}

export const CoachingAlertBanner = ({ signals, isLoading, legCountBySport }: CoachingAlertBannerProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (isLoading) {
    return (
      <div className="px-3 py-2 bg-primary/5 border-b border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-3 w-3 rounded-full bg-primary/30 animate-pulse" />
          <span>Analyzing coaching tendencies...</span>
        </div>
      </div>
    );
  }
  
  if (signals.length === 0) {
    return (
      <div className="px-3 py-2 bg-muted/30 border-b border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MinusCircle className="h-3 w-3" />
          <span>No coaching data for these teams</span>
        </div>
      </div>
    );
  }
  
  const pickCount = signals.filter(s => s.recommendation === 'PICK').length;
  const fadeCount = signals.filter(s => s.recommendation === 'FADE').length;
  
  const totalWarnings = signals.reduce((acc, s) => acc + s.warnings.length, 0);
  
  // Group signals by sport
  const signalsBySport = signals.reduce((acc, signal) => {
    if (!acc[signal.sport]) acc[signal.sport] = [];
    acc[signal.sport].push(signal);
    return acc;
  }, {} as Record<SportType, SportsCoachingSignal[]>);
  
  // Determine banner severity
  const bannerSeverity = fadeCount > 0 ? 'warning' : pickCount > 0 ? 'success' : 'neutral';
  
  const getBannerStyles = () => {
    switch (bannerSeverity) {
      case 'warning':
        return 'bg-red-500/10 border-red-500/20';
      case 'success':
        return 'bg-green-500/10 border-green-500/20';
      default:
        return 'bg-yellow-500/10 border-yellow-500/20';
    }
  };
  
  const getHeaderIcon = () => {
    switch (bannerSeverity) {
      case 'warning':
        return <AlertTriangle className="h-3.5 w-3.5 text-red-400" />;
      case 'success':
        return <CheckCircle className="h-3.5 w-3.5 text-green-400" />;
      default:
        return <MinusCircle className="h-3.5 w-3.5 text-yellow-400" />;
    }
  };
  
  // Get sport icons summary
  const sportsSummary = Object.keys(signalsBySport).map(sport => 
    SPORT_ICONS[sport as SportType]
  ).join(' ');
  
  return (
    <div className={cn("border-b", getBannerStyles())}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          {getHeaderIcon()}
          <span className="text-xs font-medium">{sportsSummary} COACHING ALERTS</span>
          <span className="text-[10px] text-muted-foreground">
            {signals.length} leg{signals.length !== 1 ? 's' : ''} • {totalWarnings} signal{totalWarnings !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {fadeCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">
              {fadeCount} FADE
            </span>
          )}
          {pickCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">
              {pickCount} PICK
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-2">
              {Object.entries(signalsBySport).map(([sport, sportSignals]) => (
                <div key={sport}>
                  <div className="text-[10px] text-muted-foreground font-medium mb-1 flex items-center gap-1">
                    {SPORT_ICONS[sport as SportType]} {sport}
                  </div>
                  <div className="space-y-1.5">
                    {sportSignals.map(signal => (
                      <SignalRow key={signal.legId} signal={signal} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SignalRow = ({ signal }: { signal: SportsCoachingSignal }) => {
  const getIcon = () => {
    switch (signal.recommendation) {
      case 'PICK':
        return <CheckCircle className="h-3 w-3 text-green-400" />;
      case 'FADE':
        return <AlertTriangle className="h-3 w-3 text-red-400" />;
      default:
        return <MinusCircle className="h-3 w-3 text-yellow-400" />;
    }
  };
  
  const primaryWarning = signal.warnings[0] || signal.reasoning[0] || 'Standard coaching profile';
  
  // Format adjustment preview based on sport
  const adjustmentPreview = () => {
    const parts: string[] = [];
    const adjustments = signal.propAdjustments;
    
    Object.entries(adjustments).slice(0, 2).forEach(([key, value]) => {
      if (value !== 0) {
        const shortKey = key.split('_')[0];
        parts.push(`${value > 0 ? '+' : ''}${value}% ${shortKey}`);
      }
    });
    
    return parts.join(', ');
  };
  
  return (
    <div className={cn(
      "flex items-start gap-2 p-2 rounded-md text-xs",
      signal.recommendation === 'FADE' ? 'bg-red-500/10' :
      signal.recommendation === 'PICK' ? 'bg-green-500/10' : 'bg-muted/30'
    )}>
      <div className="shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-semibold">{signal.coachName}</span>
          <span className="text-muted-foreground">({signal.teamName.split(' ').pop()})</span>
        </div>
        <p className="text-muted-foreground truncate">{primaryWarning}</p>
        {adjustmentPreview() && (
          <p className="text-[10px] text-primary font-mono mt-0.5">{adjustmentPreview()}</p>
        )}
      </div>
      <span className={cn(
        "shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded",
        signal.recommendation === 'PICK' ? 'bg-green-500/20 text-green-400' :
        signal.recommendation === 'FADE' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
      )}>
        {signal.recommendation}
      </span>
    </div>
  );
};
