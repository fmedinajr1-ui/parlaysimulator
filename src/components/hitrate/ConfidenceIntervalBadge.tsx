import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { AlertTriangle, CheckCircle, HelpCircle } from "lucide-react";

interface ConfidenceIntervalBadgeProps {
  winRate: number;
  sampleSize: number;
  showInterval?: boolean;
  compact?: boolean;
}

/**
 * Wilson Score Confidence Interval Calculator
 * More accurate than normal approximation for small samples and extreme proportions
 */
export function calculateWilsonScore(successRate: number, sampleSize: number, z = 1.96): {
  lower: number;
  upper: number;
  margin: number;
} {
  if (sampleSize === 0) {
    return { lower: 0, upper: 1, margin: 0.5 };
  }

  const p = successRate / 100; // Convert percentage to proportion
  const n = sampleSize;
  
  // Wilson score interval formula
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denominator;
  
  return {
    lower: Math.max(0, (center - margin) * 100),
    upper: Math.min(100, (center + margin) * 100),
    margin: margin * 100,
  };
}

export function getConfidenceTier(sampleSize: number): {
  tier: 'high' | 'medium' | 'low' | 'insufficient';
  label: string;
  color: string;
} {
  if (sampleSize >= 50) {
    return { tier: 'high', label: 'High confidence', color: 'text-neon-green' };
  } else if (sampleSize >= 20) {
    return { tier: 'medium', label: 'Medium confidence', color: 'text-neon-yellow' };
  } else if (sampleSize >= 10) {
    return { tier: 'low', label: 'Low confidence', color: 'text-orange-400' };
  } else {
    return { tier: 'insufficient', label: 'Insufficient data', color: 'text-red-400' };
  }
}

export function ConfidenceIntervalBadge({
  winRate,
  sampleSize,
  showInterval = true,
  compact = false,
}: ConfidenceIntervalBadgeProps) {
  const { lower, upper, margin } = calculateWilsonScore(winRate, sampleSize);
  const confidence = getConfidenceTier(sampleSize);
  
  const formattedInterval = `${lower.toFixed(0)}% - ${upper.toFixed(0)}%`;
  const formattedMargin = `±${margin.toFixed(0)}%`;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className={`font-mono text-xs ${confidence.color} border-current/30 bg-current/5`}
            >
              {winRate.toFixed(0)}% {formattedMargin}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-[250px]">
            <div className="space-y-1">
              <p className="font-medium">95% Confidence Interval</p>
              <p className="text-sm text-muted-foreground">{formattedInterval}</p>
              <p className="text-xs text-muted-foreground">
                Based on {sampleSize} samples • {confidence.label}
              </p>
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
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">{winRate.toFixed(1)}%</span>
            {showInterval && (
              <Badge 
                variant="outline" 
                className={`font-mono text-xs ${confidence.color} border-current/30 bg-current/5`}
              >
                {formattedMargin}
              </Badge>
            )}
            {confidence.tier === 'insufficient' && (
              <AlertTriangle className="h-4 w-4 text-orange-400" />
            )}
            {confidence.tier === 'high' && (
              <CheckCircle className="h-4 w-4 text-neon-green" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-primary" />
              <span className="font-medium">95% Confidence Interval</span>
            </div>
            <p className="text-sm">
              True hit rate likely between <strong>{formattedInterval}</strong>
            </p>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Samples: {sampleSize}</span>
              <Badge variant="secondary" className="text-[10px]">
                {confidence.label}
              </Badge>
            </div>
            {confidence.tier === 'insufficient' && (
              <p className="text-xs text-orange-400">
                ⚠️ Small sample size - interpret with caution
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
