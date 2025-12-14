import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Beaker, 
  Zap, 
  TrendingUp, 
  TrendingDown, 
  Target,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
} from 'lucide-react';
import { HybridSimulationResult, LegSimulationResult } from '@/lib/hybrid-monte-carlo';

interface HybridAnalysisCardProps {
  result: HybridSimulationResult;
  compact?: boolean;
}

export function HybridAnalysisCard({ result, compact = false }: HybridAnalysisCardProps) {
  const {
    independentWinRate,
    correlatedWinRate,
    hybridWinRate,
    expectedValue,
    legResults,
    overallEdge,
    recommendation,
    confidenceLevel,
    kellyFraction,
    sharpeRatio,
    correlationsApplied,
  } = result;

  const recommendationConfig = useMemo(() => {
    switch (recommendation) {
      case 'strong_bet':
        return { 
          label: 'Strong Bet', 
          color: 'bg-green-500/20 text-green-400 border-green-500/30',
          icon: CheckCircle,
        };
      case 'value_bet':
        return { 
          label: 'Value Bet', 
          color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
          icon: TrendingUp,
        };
      case 'fade':
        return { 
          label: 'Fade', 
          color: 'bg-red-500/20 text-red-400 border-red-500/30',
          icon: XCircle,
        };
      default:
        return { 
          label: 'Skip', 
          color: 'bg-muted text-muted-foreground border-border',
          icon: AlertTriangle,
        };
    }
  }, [recommendation]);

  const correlationDiff = correlatedWinRate - independentWinRate;
  const correlationImpact = correlationDiff > 0 ? 'positive' : correlationDiff < -0.01 ? 'negative' : 'neutral';

  if (compact) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border/50">
        <Beaker className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Hybrid Win Rate:</span>
            <span className="text-sm font-bold text-primary">
              {(hybridWinRate * 100).toFixed(1)}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Edge: {(overallEdge * 100).toFixed(1)}% • Kelly: {(kellyFraction * 100).toFixed(1)}%
          </div>
        </div>
        <Badge variant="outline" className={recommendationConfig.color}>
          {recommendationConfig.label}
        </Badge>
      </div>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Beaker className="h-5 w-5 text-primary" />
            Hybrid Analysis
          </CardTitle>
          <Badge variant="outline" className={recommendationConfig.color}>
            <recommendationConfig.icon className="h-3 w-3 mr-1" />
            {recommendationConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Metrics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-background/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Hybrid Win Rate</div>
            <div className="text-2xl font-bold text-primary">
              {(hybridWinRate * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              Parametric + MC
            </div>
          </div>
          <div className="bg-background/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Overall Edge</div>
            <div className={`text-2xl font-bold ${overallEdge >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {overallEdge >= 0 ? '+' : ''}{(overallEdge * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              vs implied odds
            </div>
          </div>
          <div className="bg-background/50 rounded-lg p-3 text-center">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Expected Value</div>
            <div className={`text-2xl font-bold ${expectedValue >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {expectedValue >= 0 ? '+' : ''}{(expectedValue * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              per $100 bet
            </div>
          </div>
        </div>

        {/* Win Rate Comparison */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Independent Model</span>
            <span className="font-mono">{(independentWinRate * 100).toFixed(2)}%</span>
          </div>
          <Progress value={independentWinRate * 100} className="h-2" />
          
          {correlationsApplied && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  Correlated Model
                  {correlationImpact === 'positive' && (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                  )}
                  {correlationImpact === 'negative' && (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                  )}
                </span>
                <span className="font-mono">
                  {(correlatedWinRate * 100).toFixed(2)}%
                  <span className={`ml-1 text-xs ${correlationDiff >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ({correlationDiff >= 0 ? '+' : ''}{(correlationDiff * 100).toFixed(1)}%)
                  </span>
                </span>
              </div>
              <Progress value={correlatedWinRate * 100} className="h-2" />
            </>
          )}
        </div>

        {/* Risk Metrics */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-xs text-muted-foreground">Kelly %</div>
            <div className="text-sm font-semibold">{(kellyFraction * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-xs text-muted-foreground">Sharpe</div>
            <div className="text-sm font-semibold">{sharpeRatio.toFixed(2)}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-xs text-muted-foreground">Confidence</div>
            <div className="text-sm font-semibold">{(confidenceLevel * 100).toFixed(0)}%</div>
          </div>
        </div>

        {/* Leg Breakdown */}
        {legResults.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Leg Analysis
            </h4>
            <div className="space-y-1">
              {legResults.map((leg, idx) => (
                <LegResultRow key={leg.legId} leg={leg} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* Correlation Impact Note */}
        {correlationsApplied && Math.abs(correlationDiff) > 0.01 && (
          <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
            correlationImpact === 'positive' 
              ? 'bg-green-500/10 text-green-400'
              : correlationImpact === 'negative'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-muted text-muted-foreground'
          }`}>
            <Target className="h-4 w-4" />
            <span>
              {correlationImpact === 'positive' 
                ? `Positive correlations boosted win rate by ${(correlationDiff * 100).toFixed(1)}%`
                : `Negative correlations reduced win rate by ${(Math.abs(correlationDiff) * 100).toFixed(1)}%`
              }
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Individual leg result row
function LegResultRow({ leg, index }: { leg: LegSimulationResult; index: number }) {
  const { screening } = leg;
  const edgeColor = screening.edgeEstimate >= 0.05 
    ? 'text-green-500' 
    : screening.edgeEstimate <= -0.03 
    ? 'text-red-500' 
    : 'text-muted-foreground';

  return (
    <div className="flex items-center justify-between p-2 rounded bg-background/30 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">#{index + 1}</span>
        <span className="font-medium">{leg.legId.slice(0, 20)}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="font-mono">{(leg.hybridProbability * 100).toFixed(1)}%</div>
          <div className={`text-[10px] ${edgeColor}`}>
            Edge: {screening.edgeEstimate >= 0 ? '+' : ''}{(screening.edgeEstimate * 100).toFixed(1)}%
          </div>
        </div>
        {screening.recommendation === 'strong_pick' && (
          <Zap className="h-3 w-3 text-yellow-500" />
        )}
        {screening.recommendation === 'avoid' && (
          <AlertTriangle className="h-3 w-3 text-red-500" />
        )}
      </div>
    </div>
  );
}
