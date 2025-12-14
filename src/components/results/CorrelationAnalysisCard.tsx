import { useState, useEffect } from 'react';
import { ParlayLeg } from '@/types/parlay';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  quickCorrelationAnalysis, 
} from '@/lib/monte-carlo-correlated';
import { 
  CorrelationMatrix, 
  LegCorrelation,
  getCorrelationSeverity 
} from '@/lib/correlation-engine';
import { 
  Link2, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp, 
  TrendingDown,
  Loader2,
  ChevronDown,
  ChevronUp,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface CorrelationAnalysisCardProps {
  legs: ParlayLeg[];
  delay?: number;
}

export function CorrelationAnalysisCard({ legs, delay = 0 }: CorrelationAnalysisCardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [analysis, setAnalysis] = useState<{
    correlationMatrix: CorrelationMatrix;
    independentProbability: number;
    estimatedCorrelatedProbability: number;
    correlationAdjustment: number;
    warnings: string[];
  } | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (legs.length < 2) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    quickCorrelationAnalysis(legs)
      .then(setAnalysis)
      .finally(() => setIsLoading(false));
  }, [legs]);

  if (legs.length < 2) return null;
  
  if (isLoading) {
    return (
      <FeedCard 
        variant="full-bleed" 
        className="slide-up"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Analyzing correlations...</span>
        </div>
      </FeedCard>
    );
  }

  if (!analysis) return null;

  const severity = getCorrelationSeverity(analysis.correlationMatrix.avgCorrelation);
  const hasImpact = Math.abs(analysis.correlationAdjustment - 1) > 0.01;
  const impactDirection = analysis.correlationAdjustment > 1 ? 'positive' : 'negative';
  
  const highCorrelations = analysis.correlationMatrix.correlations.filter(
    c => c.correlation > 0.25
  );

  return (
    <FeedCard 
      variant="full-bleed" 
      className={cn(
        "slide-up transition-all cursor-pointer",
        severity === 'high' && "border-neon-orange/30 bg-neon-orange/5",
        severity === 'medium' && "border-neon-yellow/30 bg-neon-yellow/5",
        severity === 'low' && "border-primary/30 bg-primary/5",
        severity === 'none' && "border-neon-green/30 bg-neon-green/5"
      )}
      style={{ animationDelay: `${delay}ms` }}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            severity === 'high' && "bg-neon-orange/20",
            severity === 'medium' && "bg-neon-yellow/20",
            severity === 'low' && "bg-primary/20",
            severity === 'none' && "bg-neon-green/20"
          )}>
            <Layers className={cn(
              "w-4 h-4",
              severity === 'high' && "text-neon-orange",
              severity === 'medium' && "text-neon-yellow",
              severity === 'low' && "text-primary",
              severity === 'none' && "text-neon-green"
            )} />
          </div>
          <div>
            <h3 className="font-display text-sm sm:text-base text-foreground">
              CORRELATION ANALYSIS
            </h3>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              {severity === 'none' ? 'Legs appear independent' : `${severity.charAt(0).toUpperCase() + severity.slice(1)} correlation detected`}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Badge className={cn(
            "text-[10px] sm:text-xs",
            severity === 'high' && "bg-neon-orange/20 text-neon-orange border-neon-orange/30",
            severity === 'medium' && "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
            severity === 'low' && "bg-primary/20 text-primary border-primary/30",
            severity === 'none' && "bg-neon-green/20 text-neon-green border-neon-green/30"
          )}>
            {(analysis.correlationMatrix.avgCorrelation * 100).toFixed(0)}% avg
          </Badge>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg p-2 bg-card/50 border border-border/50">
          <p className="text-[10px] text-muted-foreground mb-0.5">Independent</p>
          <p className="text-sm sm:text-base font-bold text-foreground">
            {(analysis.independentProbability * 100).toFixed(2)}%
          </p>
        </div>
        <div className={cn(
          "rounded-lg p-2 border",
          impactDirection === 'positive' 
            ? "bg-neon-green/10 border-neon-green/30" 
            : "bg-neon-red/10 border-neon-red/30"
        )}>
          <div className="flex items-center gap-1 mb-0.5">
            <p className="text-[10px] text-muted-foreground">Adjusted</p>
            {impactDirection === 'positive' ? (
              <TrendingUp className="w-3 h-3 text-neon-green" />
            ) : (
              <TrendingDown className="w-3 h-3 text-neon-red" />
            )}
          </div>
          <p className={cn(
            "text-sm sm:text-base font-bold",
            impactDirection === 'positive' ? "text-neon-green" : "text-neon-red"
          )}>
            {(analysis.estimatedCorrelatedProbability * 100).toFixed(2)}%
          </p>
        </div>
      </div>

      {/* Impact Badge */}
      {hasImpact && (
        <div className={cn(
          "rounded-lg p-2 mb-3",
          impactDirection === 'positive' 
            ? "bg-neon-green/10 border border-neon-green/20" 
            : "bg-neon-orange/10 border border-neon-orange/20"
        )}>
          <div className="flex items-center gap-2">
            {impactDirection === 'positive' ? (
              <CheckCircle className="w-4 h-4 text-neon-green" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-neon-orange" />
            )}
            <p className={cn(
              "text-xs sm:text-sm",
              impactDirection === 'positive' ? "text-neon-green" : "text-neon-orange"
            )}>
              {impactDirection === 'positive' 
                ? `Positive correlations boost win probability by ${((analysis.correlationAdjustment - 1) * 100).toFixed(1)}%`
                : `Negative correlations reduce win probability by ${((1 - analysis.correlationAdjustment) * 100).toFixed(1)}%`
              }
            </p>
          </div>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="space-y-3 mt-3 pt-3 border-t border-border/50">
          {/* Warnings */}
          {analysis.warnings.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground">Detected Issues</h4>
              {analysis.warnings.map((warning, idx) => (
                <div 
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-neon-orange/10 border border-neon-orange/20"
                >
                  <AlertTriangle className="w-3 h-3 text-neon-orange mt-0.5 shrink-0" />
                  <p className="text-[10px] sm:text-xs text-neon-orange">{warning}</p>
                </div>
              ))}
            </div>
          )}

          {/* Correlation Matrix Visualization */}
          {highCorrelations.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Correlated Leg Pairs</h4>
              <div className="space-y-2">
                {highCorrelations.map((corr, idx) => (
                  <CorrelationPair 
                    key={idx} 
                    correlation={corr} 
                    legs={legs}
                    isMobile={isMobile}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Correlation Matrix Grid */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Correlation Matrix</h4>
            <div className="overflow-x-auto">
              <CorrelationMatrixGrid matrix={analysis.correlationMatrix} legCount={legs.length} />
            </div>
          </div>

          {/* Methodology Note */}
          <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-[10px] text-muted-foreground">
              <strong>Gaussian Copula Method:</strong> Uses Cholesky decomposition to model 
              correlated random variables, providing more accurate joint probabilities than 
              naive independence assumptions.
            </p>
          </div>
        </div>
      )}
    </FeedCard>
  );
}

// ============= SUB-COMPONENTS =============

function CorrelationPair({ 
  correlation, 
  legs,
  isMobile 
}: { 
  correlation: LegCorrelation; 
  legs: ParlayLeg[];
  isMobile: boolean;
}) {
  const leg1 = legs[correlation.legIndex1];
  const leg2 = legs[correlation.legIndex2];
  
  const corrPercent = correlation.correlation * 100;
  const isHigh = corrPercent > 50;
  const isMedium = corrPercent > 25;

  return (
    <div className={cn(
      "rounded-lg p-2 border",
      isHigh && "bg-neon-orange/10 border-neon-orange/20",
      isMedium && !isHigh && "bg-neon-yellow/10 border-neon-yellow/20",
      !isMedium && "bg-primary/10 border-primary/20"
    )}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <Link2 className={cn(
            "w-3 h-3",
            isHigh && "text-neon-orange",
            isMedium && !isHigh && "text-neon-yellow",
            !isMedium && "text-primary"
          )} />
          <span className="text-[10px] text-muted-foreground">
            {correlation.correlationType.replace('_', ' ')}
          </span>
        </div>
        <Badge className={cn(
          "text-[9px]",
          isHigh && "bg-neon-orange/20 text-neon-orange",
          isMedium && !isHigh && "bg-neon-yellow/20 text-neon-yellow",
          !isMedium && "bg-primary/20 text-primary"
        )}>
          {corrPercent.toFixed(0)}% corr
        </Badge>
      </div>
      <div className="flex flex-wrap gap-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-background/50 rounded text-[10px] font-medium">
          #{correlation.legIndex1 + 1} {leg1?.description.slice(0, isMobile ? 15 : 25)}...
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-background/50 rounded text-[10px] font-medium">
          #{correlation.legIndex2 + 1} {leg2?.description.slice(0, isMobile ? 15 : 25)}...
        </span>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <Badge variant="outline" className="text-[8px]">
          {correlation.confidence} confidence
        </Badge>
        {correlation.sampleSize > 0 && (
          <Badge variant="outline" className="text-[8px]">
            n={correlation.sampleSize}
          </Badge>
        )}
      </div>
    </div>
  );
}

function CorrelationMatrixGrid({ 
  matrix, 
  legCount 
}: { 
  matrix: CorrelationMatrix; 
  legCount: number;
}) {
  return (
    <div className="inline-block min-w-fit">
      <table className="text-[9px] sm:text-[10px]">
        <thead>
          <tr>
            <th className="p-1 text-muted-foreground"></th>
            {Array.from({ length: legCount }, (_, i) => (
              <th key={i} className="p-1 text-center text-muted-foreground">L{i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.matrix.map((row, i) => (
            <tr key={i}>
              <td className="p-1 text-muted-foreground font-medium">L{i + 1}</td>
              {row.map((val, j) => {
                const isdiagonal = i === j;
                const isHigh = !isdiagonal && val > 0.3;
                const isMedium = !isdiagonal && val > 0.15;
                
                return (
                  <td 
                    key={j} 
                    className={cn(
                      "p-1 text-center min-w-[32px] rounded",
                      isdiagonal && "bg-muted/50 text-muted-foreground",
                      isHigh && "bg-neon-orange/20 text-neon-orange font-bold",
                      isMedium && !isHigh && "bg-neon-yellow/20 text-neon-yellow",
                      !isdiagonal && !isHigh && !isMedium && "bg-muted/20 text-foreground"
                    )}
                  >
                    {isdiagonal ? '—' : (val * 100).toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
