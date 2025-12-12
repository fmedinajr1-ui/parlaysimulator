import { TrendingUp, Target, Percent, Flame, Zap, Activity, Star, CheckCircle2, XCircle, Circle, HelpCircle } from 'lucide-react';
import { EngineConsensus, EngineSignal } from '@/types/parlay';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface EngineConsensusCardProps {
  consensus: EngineConsensus;
  legDescription?: string;
}

const ENGINE_CONFIG: Record<string, { icon: typeof TrendingUp; colorClass: string; label: string }> = {
  sharp: { icon: TrendingUp, colorClass: 'text-blue-400', label: 'Sharp Money' },
  pvs: { icon: Target, colorClass: 'text-purple-400', label: 'PVS Score' },
  hitrate: { icon: Percent, colorClass: 'text-cyan-400', label: 'Hit Rate' },
  juiced: { icon: Flame, colorClass: 'text-yellow-400', label: 'Juiced Props' },
  godmode: { icon: Zap, colorClass: 'text-orange-400', label: 'God Mode' },
  fatigue: { icon: Activity, colorClass: 'text-red-400', label: 'Fatigue' },
  bestbets: { icon: Star, colorClass: 'text-green-400', label: 'Best Bets' }
};

const getStatusIcon = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree':
      return <CheckCircle2 className="h-4 w-4 text-green-400" />;
    case 'disagree':
      return <XCircle className="h-4 w-4 text-red-400" />;
    case 'neutral':
      return <Circle className="h-4 w-4 text-muted-foreground" />;
    case 'no_data':
      return <HelpCircle className="h-4 w-4 text-muted-foreground/50" />;
  }
};

const getStatusBg = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree':
      return 'bg-green-500/10 border-green-500/30';
    case 'disagree':
      return 'bg-red-500/10 border-red-500/30';
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

export function EngineConsensusCard({ consensus }: EngineConsensusCardProps) {
  const { consensusScore, totalEngines, engineSignals = [] } = consensus;
  
  const agreeCount = engineSignals.filter(s => s.status === 'agree').length;
  const disagreeCount = engineSignals.filter(s => s.status === 'disagree').length;
  const neutralCount = engineSignals.filter(s => s.status === 'neutral' || s.status === 'no_data').length;
  
  const consensusPercentage = totalEngines > 0 ? Math.round((consensusScore / totalEngines) * 100) : 0;
  
  const getConsensusColor = () => {
    if (consensusPercentage >= 70) return 'text-green-400';
    if (consensusPercentage >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getConsensusGradient = () => {
    if (consensusPercentage >= 70) return 'from-green-500/20 to-green-500/5';
    if (consensusPercentage >= 50) return 'from-yellow-500/20 to-yellow-500/5';
    return 'from-red-500/20 to-red-500/5';
  };

  return (
    <div className="rounded-lg border border-border/50 bg-gradient-to-br from-card/80 to-card overflow-hidden">
      {/* Header */}
      <div className={cn(
        "px-4 py-3 flex items-center justify-between bg-gradient-to-r",
        getConsensusGradient()
      )}>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/20">
            <Target className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">ENGINE CONSENSUS</span>
        </div>
        <div className={cn("text-lg font-bold", getConsensusColor())}>
          {consensusPercentage}%
        </div>
      </div>

      {/* Engine Grid */}
      <div className="p-4">
        <TooltipProvider>
          <div className="grid grid-cols-4 gap-2 mb-4">
            {engineSignals.map((signal) => {
              const config = ENGINE_CONFIG[signal.engine.toLowerCase()] || {
                icon: Circle,
                colorClass: 'text-muted-foreground',
                label: signal.engine
              };
              const IconComponent = config.icon;

              return (
                <Tooltip key={signal.engine}>
                  <TooltipTrigger asChild>
                    <div className={cn(
                      "flex flex-col items-center p-2 rounded-lg border transition-all cursor-help",
                      getStatusBg(signal.status)
                    )}>
                      <div className="flex items-center gap-1 mb-1">
                        {getStatusIcon(signal.status)}
                      </div>
                      <IconComponent className={cn("h-4 w-4 mb-1", config.colorClass)} />
                      <span className="text-[10px] font-medium text-muted-foreground truncate max-w-full">
                        {config.label.split(' ')[0]}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {formatScore(signal.engine.toLowerCase(), signal.score)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p className="font-semibold">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{signal.reason || 'No data available'}</p>
                    {signal.confidence && (
                      <p className="text-xs mt-1">Confidence: {signal.confidence}%</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Summary Bar */}
        <div className="space-y-2">
          <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
            {agreeCount > 0 && (
              <div 
                className="bg-green-500 transition-all"
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
                className="bg-red-500 transition-all"
                style={{ width: `${(disagreeCount / totalEngines) * 100}%` }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {agreeCount} agree
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              {neutralCount} neutral
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {disagreeCount} disagree
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
