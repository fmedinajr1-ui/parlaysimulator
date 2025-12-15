import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  Link2, 
  Unlink, 
  Info,
  TrendingDown
} from "lucide-react";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipProvider, 
  TooltipTrigger 
} from "@/components/ui/tooltip";
import { CorrelationMatrix, LegCorrelation, getCorrelationSeverity } from "@/lib/correlation-engine";

interface CorrelationWarningBadgeProps {
  correlationMatrix: CorrelationMatrix;
  compact?: boolean;
}

interface CorrelationProbabilityDisplayProps {
  independentProbability: number;
  correlatedProbability: number;
  correlationImpact: number;
}

export function CorrelationWarningBadge({ 
  correlationMatrix, 
  compact = false 
}: CorrelationWarningBadgeProps) {
  const severity = getCorrelationSeverity(correlationMatrix.avgCorrelation);
  
  if (severity === 'none') {
    return compact ? null : (
      <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted-foreground/30">
        <Unlink className="h-3 w-3 mr-1" />
        Independent
      </Badge>
    );
  }
  
  const getSeverityStyle = () => {
    switch (severity) {
      case 'high':
        return 'text-destructive border-destructive/30 bg-destructive/10';
      case 'medium':
        return 'text-orange-400 border-orange-400/30 bg-orange-400/10';
      case 'low':
        return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
      default:
        return 'text-muted-foreground border-muted-foreground/30';
    }
  };
  
  const getSeverityLabel = () => {
    switch (severity) {
      case 'high': return 'High Correlation';
      case 'medium': return 'Moderate Correlation';
      case 'low': return 'Low Correlation';
      default: return 'Independent';
    }
  };
  
  const getWarningMessage = () => {
    if (severity === 'high') {
      return 'These legs are highly correlated (same player/game). The combined probability may be overstated.';
    }
    if (severity === 'medium') {
      return 'Some legs share dependencies. Consider the correlation impact on true probability.';
    }
    return 'Minor correlations detected between some legs.';
  };
  
  const highCorrelations = correlationMatrix.correlations.filter(c => c.correlation > 0.3);
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`text-[10px] cursor-help ${getSeverityStyle()}`}
          >
            {severity === 'high' ? (
              <AlertTriangle className="h-3 w-3 mr-1" />
            ) : (
              <Link2 className="h-3 w-3 mr-1" />
            )}
            {compact ? `ρ=${correlationMatrix.avgCorrelation.toFixed(2)}` : getSeverityLabel()}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">{getSeverityLabel()}</p>
            <p className="text-xs text-muted-foreground">{getWarningMessage()}</p>
            
            {highCorrelations.length > 0 && (
              <div className="pt-2 border-t border-border/50">
                <p className="text-xs font-medium mb-1">Correlated Pairs:</p>
                {highCorrelations.slice(0, 3).map((corr, idx) => (
                  <div key={idx} className="text-[10px] text-muted-foreground flex justify-between">
                    <span>Leg {corr.legIndex1 + 1} ↔ Leg {corr.legIndex2 + 1}</span>
                    <span className="font-mono">{(corr.correlation * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
            
            <div className="pt-2 border-t border-border/50 text-[10px]">
              <div className="flex justify-between">
                <span>Avg Correlation:</span>
                <span className="font-mono">{(correlationMatrix.avgCorrelation * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span>Max Correlation:</span>
                <span className="font-mono">{(correlationMatrix.maxCorrelation * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CorrelationProbabilityDisplay({
  independentProbability,
  correlatedProbability,
  correlationImpact
}: CorrelationProbabilityDisplayProps) {
  const hasSignificantImpact = Math.abs(correlationImpact) > 0.5;
  const isNegativeImpact = correlationImpact < 0;
  
  if (!hasSignificantImpact) {
    return (
      <div className="text-sm">
        <span className="font-bold text-neon-green">
          {(correlatedProbability * 100).toFixed(1)}%
        </span>
      </div>
    );
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 cursor-help">
            <div className="text-right">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground line-through">
                  {(independentProbability * 100).toFixed(1)}%
                </span>
                <span className={`font-bold ${isNegativeImpact ? 'text-orange-400' : 'text-neon-green'}`}>
                  {(correlatedProbability * 100).toFixed(1)}%
                </span>
              </div>
              {isNegativeImpact && (
                <div className="flex items-center gap-0.5 text-[10px] text-orange-400">
                  <TrendingDown className="h-3 w-3" />
                  <span>{correlationImpact.toFixed(1)}% adj</span>
                </div>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <p className="font-medium">Correlation Adjustment</p>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Independent:</span>
              <span className="font-mono">{(independentProbability * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Correlated:</span>
              <span className="font-mono">{(correlatedProbability * 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between gap-4 pt-1 border-t border-border/50">
              <span className="text-muted-foreground">Impact:</span>
              <span className={`font-mono ${isNegativeImpact ? 'text-orange-400' : 'text-neon-green'}`}>
                {correlationImpact > 0 ? '+' : ''}{correlationImpact.toFixed(2)}%
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface LegCorrelationIndicatorProps {
  correlation: LegCorrelation;
  leg1Name: string;
  leg2Name: string;
}

export function LegCorrelationIndicator({ 
  correlation, 
  leg1Name, 
  leg2Name 
}: LegCorrelationIndicatorProps) {
  const isHighCorrelation = correlation.correlation > 0.3;
  
  if (correlation.correlation < 0.1) {
    return null;
  }
  
  return (
    <div className={`
      flex items-center gap-2 text-xs p-2 rounded-lg border
      ${isHighCorrelation 
        ? 'bg-orange-400/10 border-orange-400/30 text-orange-400' 
        : 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400'}
    `}>
      <Link2 className="h-3 w-3" />
      <span className="flex-1">
        <span className="font-medium">{leg1Name}</span>
        <span className="text-muted-foreground"> ↔ </span>
        <span className="font-medium">{leg2Name}</span>
      </span>
      <Badge variant="outline" className="text-[10px]">
        {correlation.correlationType.replace('_', ' ')}
      </Badge>
      <span className="font-mono text-[10px]">
        ρ={correlation.correlation.toFixed(2)}
      </span>
    </div>
  );
}
