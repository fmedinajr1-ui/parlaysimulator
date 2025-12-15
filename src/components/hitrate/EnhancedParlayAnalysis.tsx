import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Link2, 
  Calculator, 
  Zap, 
  AlertTriangle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Loader2
} from "lucide-react";
import { ParlayLeg } from "@/types/parlay";
import { 
  buildCorrelationMatrix, 
  calculateCorrelatedProbability,
  CorrelationMatrix,
  formatCorrelationImpact
} from "@/lib/correlation-engine";
import { CorrelationWarningBadge, CorrelationProbabilityDisplay, LegCorrelationIndicator } from "./CorrelationWarningBadge";

interface EnhancedParlayAnalysisProps {
  legs: ParlayLeg[];
  legProbabilities: number[];
  displayedProbability: number;
  sport?: string;
  onCorrelationCalculated?: (correlatedProb: number, matrix: CorrelationMatrix) => void;
}

export function EnhancedParlayAnalysis({
  legs,
  legProbabilities,
  displayedProbability,
  sport,
  onCorrelationCalculated
}: EnhancedParlayAnalysisProps) {
  const [correlationMatrix, setCorrelationMatrix] = useState<CorrelationMatrix | null>(null);
  const [correlatedResult, setCorrelatedResult] = useState<{
    independentProbability: number;
    correlatedProbability: number;
    probabilityRatio: number;
    correlationImpact: number;
  } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);

  const calculateCorrelations = async () => {
    if (legs.length < 2 || hasCalculated) return;
    
    setIsCalculating(true);
    try {
      const matrix = await buildCorrelationMatrix(legs, sport);
      setCorrelationMatrix(matrix);
      
      if (legProbabilities.length === legs.length) {
        const result = calculateCorrelatedProbability(legProbabilities, matrix);
        setCorrelatedResult(result);
        onCorrelationCalculated?.(result.correlatedProbability, matrix);
      }
      
      setHasCalculated(true);
    } catch (error) {
      console.error('Error calculating correlations:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // Auto-calculate on mount if we have legs
  useEffect(() => {
    if (legs.length >= 2 && !hasCalculated) {
      calculateCorrelations();
    }
  }, [legs.length]);

  if (legs.length < 2) {
    return null;
  }

  const highCorrelations = correlationMatrix?.correlations.filter(c => c.correlation > 0.2) || [];
  const hasSignificantCorrelation = correlationMatrix?.hasHighCorrelation || false;

  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Link2 className="h-4 w-4 text-neon-purple" />
            Correlation Analysis
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {correlationMatrix && (
              <CorrelationWarningBadge correlationMatrix={correlationMatrix} />
            )}
            
            {!hasCalculated && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={calculateCorrelations}
                disabled={isCalculating}
                className="h-7 text-xs"
              >
                {isCalculating ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Calculator className="h-3 w-3 mr-1" />
                    Analyze
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Probability Comparison */}
        {correlatedResult && (
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/30">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Combined Probability</p>
              <CorrelationProbabilityDisplay
                independentProbability={correlatedResult.independentProbability}
                correlatedProbability={correlatedResult.correlatedProbability}
                correlationImpact={correlatedResult.correlationImpact}
              />
            </div>
            
            {hasSignificantCorrelation && (
              <div className="text-right">
                <Badge variant="outline" className="text-orange-400 border-orange-400/30 bg-orange-400/10">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Correlated Legs
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatCorrelationImpact(correlatedResult.correlationImpact)}
                </p>
              </div>
            )}
          </div>
        )}
        
        {/* Correlation Details */}
        {highCorrelations.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full h-7 text-xs justify-between"
            >
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {highCorrelations.length} Correlated {highCorrelations.length === 1 ? 'Pair' : 'Pairs'}
              </span>
              {showDetails ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
            
            {showDetails && (
              <div className="space-y-2 mt-2">
                {highCorrelations.map((corr, idx) => (
                  <LegCorrelationIndicator
                    key={idx}
                    correlation={corr}
                    leg1Name={legs[corr.legIndex1]?.description?.substring(0, 20) || `Leg ${corr.legIndex1 + 1}`}
                    leg2Name={legs[corr.legIndex2]?.description?.substring(0, 20) || `Leg ${corr.legIndex2 + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Summary Stats */}
        {correlationMatrix && !hasSignificantCorrelation && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3 w-3 text-neon-green" />
            <span>Legs are largely independent - probability calculation is reliable</span>
          </div>
        )}
        
        {/* Loading State */}
        {isCalculating && (
          <div className="flex items-center justify-center p-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            <span className="text-sm">Running correlation analysis...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
