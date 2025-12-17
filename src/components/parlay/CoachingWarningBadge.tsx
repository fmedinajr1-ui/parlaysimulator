import React from 'react';
import { CoachingSignal } from '@/hooks/useCoachingSignals';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CoachingWarningBadgeProps {
  signal: CoachingSignal;
  compact?: boolean;
}

export const CoachingWarningBadge = ({ signal, compact = false }: CoachingWarningBadgeProps) => {
  const getRecommendationStyles = () => {
    switch (signal.recommendation) {
      case 'PICK':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'FADE':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      default:
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    }
  };
  
  const getRecommendationIcon = () => {
    switch (signal.recommendation) {
      case 'PICK':
        return '✅';
      case 'FADE':
        return '⚠️';
      default:
        return '➖';
    }
  };
  
  const primaryWarning = signal.warnings[0] || 'Coaching analysis available';
  
  // Format prop adjustments for tooltip
  const formatAdjustments = () => {
    const adjustments: string[] = [];
    const { propAdjustments } = signal;
    
    if (propAdjustments.points !== 0) {
      adjustments.push(`${propAdjustments.points > 0 ? '+' : ''}${propAdjustments.points}% pts`);
    }
    if (propAdjustments.minutes !== 0) {
      adjustments.push(`${propAdjustments.minutes > 0 ? '+' : ''}${propAdjustments.minutes}% min`);
    }
    if (propAdjustments.rebounds !== 0) {
      adjustments.push(`${propAdjustments.rebounds > 0 ? '+' : ''}${propAdjustments.rebounds}% reb`);
    }
    if (propAdjustments.assists !== 0) {
      adjustments.push(`${propAdjustments.assists > 0 ? '+' : ''}${propAdjustments.assists}% ast`);
    }
    
    return adjustments.join(' | ');
  };
  
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-medium border cursor-help",
              getRecommendationStyles()
            )}>
              🏀 {signal.coachName.split(' ').pop()}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-1.5">
              <div className="font-semibold flex items-center gap-1.5">
                {getRecommendationIcon()} {signal.coachName} ({signal.teamName})
              </div>
              <div className="text-xs text-muted-foreground">
                {signal.reasoning[0]}
              </div>
              {signal.warnings.length > 0 && (
                <div className="text-xs">
                  {signal.warnings.map((w, i) => (
                    <div key={i} className="text-yellow-400">• {w}</div>
                  ))}
                </div>
              )}
              {formatAdjustments() && (
                <div className="text-xs text-primary font-mono">
                  {formatAdjustments()}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] border cursor-help",
            getRecommendationStyles()
          )}>
            <span>🏀</span>
            <span className="font-medium">{signal.coachName}:</span>
            <span className="truncate max-w-[120px]">{primaryWarning}</span>
            <span className={cn(
              "font-bold ml-auto",
              signal.recommendation === 'PICK' ? 'text-green-400' :
              signal.recommendation === 'FADE' ? 'text-red-400' : 'text-yellow-400'
            )}>
              {signal.recommendation}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <div className="font-semibold">
              {getRecommendationIcon()} Coach Tendency Analysis
            </div>
            <div className="text-xs space-y-1">
              {signal.reasoning.map((r, i) => (
                <div key={i}>• {r}</div>
              ))}
            </div>
            {formatAdjustments() && (
              <div className="text-xs text-primary font-mono pt-1 border-t border-border/50">
                Prop Impact: {formatAdjustments()}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Confidence: {signal.confidence}%
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
