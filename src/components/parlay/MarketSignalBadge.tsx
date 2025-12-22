import React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, Clock, Users, BarChart3 } from 'lucide-react';

export interface MarketSignal {
  market_score: number;
  signal_label: 'sharp_aligned' | 'neutral' | 'trap_risk';
  rationale: string;
  line_move_score?: number;
  juice_move_score?: number;
  timing_sharpness_score?: number;
  multi_book_consensus_score?: number;
  public_fade_score?: number;
}

interface MarketSignalBadgeProps {
  signal: MarketSignal;
  compact?: boolean;
}

export const MarketSignalBadge = ({ signal, compact = false }: MarketSignalBadgeProps) => {
  const getSignalConfig = () => {
    switch (signal.signal_label) {
      case 'sharp_aligned':
        return {
          icon: TrendingUp,
          label: 'Sharp Aligned',
          shortLabel: 'Sharp',
          bgColor: 'bg-green-500/20',
          textColor: 'text-green-400',
          borderColor: 'border-green-500/30',
          description: 'Market signals indicate sharp/professional action',
        };
      case 'trap_risk':
        return {
          icon: AlertTriangle,
          label: 'Trap Risk',
          shortLabel: 'Trap',
          bgColor: 'bg-red-500/20',
          textColor: 'text-red-400',
          borderColor: 'border-red-500/30',
          description: 'Market signals suggest potential trap - proceed with caution',
        };
      default:
        return {
          icon: Minus,
          label: 'Neutral',
          shortLabel: 'Neutral',
          bgColor: 'bg-yellow-500/20',
          textColor: 'text-yellow-400',
          borderColor: 'border-yellow-500/30',
          description: 'No clear directional signal from market activity',
        };
    }
  };

  const config = getSignalConfig();
  const Icon = config.icon;

  const getScoreBarColor = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const ScoreBar = ({ score, label, icon: ScoreIcon }: { score: number; label: string; icon: React.ElementType }) => (
    <div className="flex items-center gap-2 text-xs">
      <ScoreIcon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all", getScoreBarColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-foreground font-medium w-8 text-right">{score}</span>
    </div>
  );

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-help",
              config.bgColor,
              config.textColor,
              config.borderColor
            )}>
              <Icon className="h-2.5 w-2.5" />
              <span>{signal.market_score}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", config.textColor)} />
                <span className="font-medium">{config.label}</span>
                <span className="text-muted-foreground">({signal.market_score}/100)</span>
              </div>
              <p className="text-xs text-muted-foreground">{signal.rationale}</p>
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
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border cursor-help transition-all hover:scale-105",
            config.bgColor,
            config.textColor,
            config.borderColor
          )}>
            <Icon className="h-3.5 w-3.5" />
            <span>{config.shortLabel}</span>
            <span className="opacity-75">({signal.market_score})</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="w-72 p-3">
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", config.textColor)} />
                <span className="font-semibold">{config.label}</span>
              </div>
              <div className={cn(
                "px-2 py-0.5 rounded text-sm font-bold",
                config.bgColor,
                config.textColor
              )}>
                {signal.market_score}/100
              </div>
            </div>
            
            {/* Rationale */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              {signal.rationale}
            </p>
            
            {/* Score Breakdown */}
            {(signal.line_move_score !== undefined || signal.juice_move_score !== undefined) && (
              <div className="space-y-1.5 pt-2 border-t border-border">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Score Breakdown
                </p>
                {signal.line_move_score !== undefined && (
                  <ScoreBar score={signal.line_move_score} label="Line Move" icon={TrendingUp} />
                )}
                {signal.juice_move_score !== undefined && (
                  <ScoreBar score={signal.juice_move_score} label="Juice" icon={BarChart3} />
                )}
                {signal.timing_sharpness_score !== undefined && (
                  <ScoreBar score={signal.timing_sharpness_score} label="Timing" icon={Clock} />
                )}
                {signal.multi_book_consensus_score !== undefined && (
                  <ScoreBar score={signal.multi_book_consensus_score} label="Consensus" icon={Users} />
                )}
                {signal.public_fade_score !== undefined && (
                  <ScoreBar score={signal.public_fade_score} label="Pub Fade" icon={Zap} />
                )}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
