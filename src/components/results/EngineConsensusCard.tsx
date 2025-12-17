import { useState } from 'react';
import { TrendingUp, Target, Percent, Flame, Zap, Activity, Star, CheckCircle2, XCircle, Circle, HelpCircle, ChevronDown } from 'lucide-react';
import { EngineConsensus, EngineSignal } from '@/types/parlay';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { EngineDetailSheet } from './EngineDetailSheet';

interface EngineConsensusCardProps {
  consensus: EngineConsensus;
  legDescription?: string;
  variant?: 'full' | 'compact' | 'mini';
}

const ENGINE_CONFIG: Record<string, { icon: typeof TrendingUp; colorClass: string; label: string; shortLabel: string }> = {
  sharp: { icon: TrendingUp, colorClass: 'text-blue-400', label: 'Sharp Money', shortLabel: 'Sharp' },
  pvs: { icon: Target, colorClass: 'text-purple-400', label: 'PVS Score', shortLabel: 'PVS' },
  hitrate: { icon: Percent, colorClass: 'text-cyan-400', label: 'Hit Rate', shortLabel: 'Hit%' },
  juiced: { icon: Flame, colorClass: 'text-yellow-400', label: 'Juiced Props', shortLabel: 'Juice' },
  godmode: { icon: Zap, colorClass: 'text-orange-400', label: 'God Mode', shortLabel: 'God' },
  fatigue: { icon: Activity, colorClass: 'text-red-400', label: 'Fatigue', shortLabel: 'Fat' },
  bestbets: { icon: Star, colorClass: 'text-green-400', label: 'Best Bets', shortLabel: 'Best' },
  coaching: { icon: Target, colorClass: 'text-emerald-400', label: 'Coaching', shortLabel: 'Coach' }
};

const getStatusIcon = (status: EngineSignal['status'], size: 'sm' | 'md' = 'md') => {
  const sizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  switch (status) {
    case 'agree':
      return <CheckCircle2 className={cn(sizeClass, "text-neon-green")} />;
    case 'disagree':
      return <XCircle className={cn(sizeClass, "text-neon-red")} />;
    case 'neutral':
      return <Circle className={cn(sizeClass, "text-muted-foreground")} />;
    case 'no_data':
      return <HelpCircle className={cn(sizeClass, "text-muted-foreground/50")} />;
  }
};

const getStatusBg = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree':
      return 'bg-neon-green/10 border-neon-green/30';
    case 'disagree':
      return 'bg-neon-red/10 border-neon-red/30';
    case 'neutral':
      return 'bg-muted/30 border-muted-foreground/20';
    case 'no_data':
      return 'bg-muted/10 border-muted-foreground/10 opacity-50';
  }
};

const formatScore = (engine: string, score: number | null): string => {
  if (score === null) return 'N/A';
  
  switch (engine) {
    case 'sharp':
    case 'hitrate':
    case 'fatigue':
    case 'coaching':
      return `${Math.round(score)}%`;
    case 'pvs':
      return score >= 80 ? 'S' : score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 35 ? 'C' : 'D';
    case 'godmode':
      return score >= 70 ? 'Bet' : score >= 40 ? 'Watch' : 'Avoid';
    case 'juiced':
      return score > 0 ? 'Over' : score < 0 ? 'Under' : 'Even';
    case 'bestbets':
      return score > 0 ? 'Pick' : 'No';
    default:
      return String(score);
  }
};

export function EngineConsensusCard({ consensus, variant: propVariant }: EngineConsensusCardProps) {
  const isMobile = useIsMobile();
  const { lightTap } = useHapticFeedback();
  const [selectedSignal, setSelectedSignal] = useState<EngineSignal | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  
  const variant = propVariant || (isMobile ? 'compact' : 'full');
  const { consensusScore, totalEngines, engineSignals = [] } = consensus;
  
  const agreeCount = engineSignals.filter(s => s.status === 'agree').length;
  const disagreeCount = engineSignals.filter(s => s.status === 'disagree').length;
  const neutralCount = engineSignals.filter(s => s.status === 'neutral' || s.status === 'no_data').length;
  
  const consensusPercentage = totalEngines > 0 ? Math.round((consensusScore / totalEngines) * 100) : 0;
  
  const getConsensusColor = () => {
    if (consensusPercentage >= 70) return 'text-neon-green';
    if (consensusPercentage >= 50) return 'text-neon-yellow';
    return 'text-neon-red';
  };

  const getConsensusGradient = () => {
    if (consensusPercentage >= 70) return 'from-neon-green/20 to-neon-green/5';
    if (consensusPercentage >= 50) return 'from-neon-yellow/20 to-neon-yellow/5';
    return 'from-neon-red/20 to-neon-red/5';
  };

  const handleEngineClick = (signal: EngineSignal) => {
    lightTap();
    setSelectedSignal(signal);
  };

  // Mini variant - inline pill display
  if (variant === 'mini') {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-card/80 border border-border/30 text-xs">
        <span className={cn("font-bold", getConsensusColor())}>{consensusPercentage}%</span>
        <div className="flex items-center gap-0.5">
          {engineSignals.slice(0, 5).map((signal) => (
            <span key={signal.engine} className="flex items-center">
              {getStatusIcon(signal.status, 'sm')}
            </span>
          ))}
        </div>
        {engineSignals.length > 5 && (
          <span className="text-muted-foreground">+{engineSignals.length - 5}</span>
        )}
      </div>
    );
  }

  const visibleSignals = variant === 'compact' && !isExpanded 
    ? engineSignals.slice(0, 4) 
    : engineSignals;
  const hasMore = engineSignals.length > 4;

  return (
    <>
      <div className="rounded-lg border border-border/50 bg-gradient-to-br from-card/80 to-card overflow-hidden">
        {/* Header */}
        <div className={cn(
          "px-3 py-2 sm:px-4 sm:py-3 flex items-center justify-between bg-gradient-to-r",
          getConsensusGradient()
        )}>
          <div className="flex items-center gap-2">
            <div className="p-1 sm:p-1.5 rounded-md bg-primary/20">
              <Target className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
            </div>
            <span className="text-xs sm:text-sm font-semibold text-foreground">ENGINE CONSENSUS</span>
          </div>
          <div className={cn("text-base sm:text-lg font-bold", getConsensusColor())}>
            {consensusPercentage}%
          </div>
        </div>

        {/* Engine Grid - Responsive */}
        <div className="p-3 sm:p-4">
          <div className={cn(
            "grid gap-2",
            variant === 'compact' ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"
          )}>
            {visibleSignals.map((signal) => {
              const config = ENGINE_CONFIG[signal.engine.toLowerCase()] || {
                icon: Circle,
                colorClass: 'text-muted-foreground',
                label: signal.engine,
                shortLabel: signal.engine.slice(0, 4)
              };
              const IconComponent = config.icon;

              return (
                <button
                  key={signal.engine}
                  onClick={() => handleEngineClick(signal)}
                  className={cn(
                    "flex flex-col items-center p-2 rounded-lg border transition-all",
                    "touch-target active:scale-95 cursor-pointer",
                    getStatusBg(signal.status)
                  )}
                >
                  <div className="flex items-center gap-1 mb-1">
                    {getStatusIcon(signal.status, 'sm')}
                  </div>
                  <IconComponent className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4 mb-1", config.colorClass)} />
                  <span className="text-[9px] sm:text-[10px] font-medium text-muted-foreground truncate max-w-full">
                    {isMobile ? config.shortLabel : config.label.split(' ')[0]}
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-foreground">
                    {formatScore(signal.engine.toLowerCase(), signal.score)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Show More Button - Compact Mode Only */}
          {variant === 'compact' && hasMore && (
            <button
              onClick={() => {
                lightTap();
                setIsExpanded(!isExpanded);
              }}
              className={cn(
                "w-full mt-3 py-2 flex items-center justify-center gap-1",
                "text-xs text-muted-foreground hover:text-foreground",
                "border border-dashed border-border/50 rounded-lg",
                "transition-all active:scale-98"
              )}
            >
              <span>{isExpanded ? 'Show less' : `Show all ${engineSignals.length}`}</span>
              <ChevronDown className={cn(
                "h-3 w-3 transition-transform",
                isExpanded && "rotate-180"
              )} />
            </button>
          )}

          {/* Summary Bar */}
          <div className="space-y-2 mt-3">
            <div className="flex h-1.5 sm:h-2 rounded-full overflow-hidden bg-muted/30">
              {agreeCount > 0 && (
                <div 
                  className="bg-neon-green transition-all"
                  style={{ width: `${(agreeCount / totalEngines) * 100}%` }}
                />
              )}
              {neutralCount > 0 && (
                <div 
                  className="bg-muted-foreground/30 transition-all"
                  style={{ width: `${(neutralCount / totalEngines) * 100}%` }}
                />
              )}
              {disagreeCount > 0 && (
                <div 
                  className="bg-neon-red transition-all"
                  style={{ width: `${(disagreeCount / totalEngines) * 100}%` }}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-neon-green" />
                {agreeCount} agree
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-muted-foreground/30" />
                {neutralCount} neutral
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-neon-red" />
                {disagreeCount} disagree
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Engine Detail Sheet */}
      <EngineDetailSheet
        open={!!selectedSignal}
        onOpenChange={(open) => !open && setSelectedSignal(null)}
        signal={selectedSignal}
      />
    </>
  );
}
