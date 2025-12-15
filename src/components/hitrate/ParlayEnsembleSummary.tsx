import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  runEnsemble, 
  aggregateParlayEnsemble, 
  extractHitRateSignals,
  EnsembleResult 
} from '@/lib/ensemble-engine';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ParlayEnsembleSummaryProps {
  legs: Array<{
    hit_rate_over?: number;
    hit_rate_under?: number;
    recommended_side?: string;
    consistency_score?: number;
    line_value_label?: string;
    trend_direction?: string;
    confidence_score?: number;
    season_avg?: number;
    current_line?: number;
    player_name?: string;
  }>;
  compact?: boolean;
}

export function ParlayEnsembleSummary({ legs, compact = false }: ParlayEnsembleSummaryProps) {
  const { legResults, aggregated } = useMemo(() => {
    const results = legs.map(leg => {
      const signals = extractHitRateSignals(leg);
      return runEnsemble(signals);
    });
    
    return {
      legResults: results,
      aggregated: aggregateParlayEnsemble(results)
    };
  }, [legs]);

  const getRiskStyles = (risk: 'low' | 'medium' | 'high' | 'extreme') => {
    switch (risk) {
      case 'low':
        return {
          bg: 'bg-chart-2/10',
          border: 'border-chart-2/30',
          text: 'text-chart-2',
          icon: CheckCircle2
        };
      case 'medium':
        return {
          bg: 'bg-chart-4/10',
          border: 'border-chart-4/30',
          text: 'text-chart-4',
          icon: Shield
        };
      case 'high':
        return {
          bg: 'bg-orange-500/10',
          border: 'border-orange-500/30',
          text: 'text-orange-400',
          icon: AlertTriangle
        };
      case 'extreme':
        return {
          bg: 'bg-destructive/10',
          border: 'border-destructive/30',
          text: 'text-destructive',
          icon: XCircle
        };
    }
  };

  const riskStyles = getRiskStyles(aggregated.parlayRisk);
  const RiskIcon = riskStyles.icon;

  const getConsensusLabel = (consensus: EnsembleResult['consensus']) => {
    switch (consensus) {
      case 'strong_pick': return 'Strong Pick';
      case 'lean_pick': return 'Lean Pick';
      case 'neutral': return 'Mixed';
      case 'lean_fade': return 'Lean Fade';
      case 'strong_fade': return 'Strong Fade';
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge 
          variant="outline" 
          className={cn('gap-1 border', riskStyles.bg, riskStyles.border, riskStyles.text)}
        >
          <RiskIcon className="h-3 w-3" />
          {aggregated.parlayRisk.toUpperCase()} RISK
        </Badge>
        <Badge variant="outline" className="gap-1 text-muted-foreground border-border/50">
          Score: {aggregated.overallScore.toFixed(0)}
        </Badge>
        {aggregated.weakestLeg >= 0 && aggregated.parlayRisk !== 'low' && (
          <Badge variant="outline" className="gap-1 text-orange-400 border-orange-400/30">
            <TrendingDown className="h-3 w-3" />
            Weak: Leg {aggregated.weakestLeg + 1}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <Card className={cn('border', riskStyles.bg, riskStyles.border)}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RiskIcon className={cn('h-5 w-5', riskStyles.text)} />
            <span className={cn('font-medium', riskStyles.text)}>
              {aggregated.parlayRisk.charAt(0).toUpperCase() + aggregated.parlayRisk.slice(1)} Risk
            </span>
          </div>
          <Badge variant="outline" className="text-xs">
            {getConsensusLabel(aggregated.overallConsensus)}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">{aggregated.recommendation}</p>

        {/* Leg Strength Indicators */}
        <div className="flex items-center gap-1 pt-1">
          {legResults.map((result, idx) => {
            const isWeakest = idx === aggregated.weakestLeg;
            const isStrongest = idx === aggregated.strongestLeg;
            const score = result.consensusScore;
            
            let bgColor = 'bg-muted';
            if (score >= 30) bgColor = 'bg-chart-2';
            else if (score >= 10) bgColor = 'bg-chart-2/60';
            else if (score <= -30) bgColor = 'bg-destructive';
            else if (score <= -10) bgColor = 'bg-orange-500';
            
            return (
              <div
                key={idx}
                className={cn(
                  'h-2 flex-1 rounded-full transition-all',
                  bgColor,
                  isWeakest && 'ring-2 ring-orange-400 ring-offset-1 ring-offset-background',
                  isStrongest && 'ring-2 ring-chart-2 ring-offset-1 ring-offset-background'
                )}
                title={`Leg ${idx + 1}: Score ${score.toFixed(0)}`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-chart-2" />
            <span>Strongest: Leg {aggregated.strongestLeg + 1}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingDown className="h-3 w-3 text-orange-400" />
            <span>Weakest: Leg {aggregated.weakestLeg + 1}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
