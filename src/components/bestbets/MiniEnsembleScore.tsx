import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity, Users } from 'lucide-react';
import { runEnsemble, EngineSignal } from '@/lib/ensemble-engine';
import { cn } from '@/lib/utils';

interface MiniEnsembleScoreProps {
  signals: EngineSignal[];
}

export function MiniEnsembleScore({ signals }: MiniEnsembleScoreProps) {
  const result = useMemo(() => {
    if (signals.length === 0) return null;
    return runEnsemble(signals);
  }, [signals]);

  if (!result) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted/30">
        No Signals
      </Badge>
    );
  }

  const getConsensusColor = () => {
    if (result.consensus === 'strong_pick') return 'text-chart-2 bg-chart-2/10 border-chart-2/30';
    if (result.consensus === 'lean_pick') return 'text-chart-2/80 bg-chart-2/5 border-chart-2/20';
    if (result.consensus === 'strong_fade') return 'text-destructive bg-destructive/10 border-destructive/30';
    if (result.consensus === 'lean_fade') return 'text-destructive/80 bg-destructive/5 border-destructive/20';
    return 'text-muted-foreground bg-muted/10 border-muted/30';
  };

  const getConsensusLabel = () => {
    if (result.consensus === 'strong_pick') return 'PICK';
    if (result.consensus === 'lean_pick') return 'Lean';
    if (result.consensus === 'strong_fade') return 'FADE';
    if (result.consensus === 'lean_fade') return 'Fade';
    return 'Neutral';
  };

  const getScoreDisplay = () => {
    const score = result.consensusScore;
    const sign = score > 0 ? '+' : '';
    return `${sign}${Math.round(score)}`;
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={cn('text-xs gap-1 border font-mono', getConsensusColor())}>
              <Activity className="h-3 w-3" />
              {getScoreDisplay()}
            </Badge>
            <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-muted/30">
              <Users className="h-3 w-3" />
              {result.topContributors.length}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px]">
          <div className="space-y-1.5 text-xs">
            <p className="font-medium">Ensemble Consensus: {getConsensusLabel()}</p>
            <p>Score: {getScoreDisplay()} / 100</p>
            <p>Confidence: {(result.weightedConfidence * 100).toFixed(0)}%</p>
            <div>
              <p className="text-muted-foreground">Active Engines:</p>
              <p>{result.topContributors.join(', ') || 'None'}</p>
            </div>
            {result.conflictingSignals.length > 0 && (
              <p className="text-chart-4">⚠ {result.conflictingSignals.length} conflicting signal(s)</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
