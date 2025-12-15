import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calculateParlayKelly, americanToDecimal, calculateVariance } from '@/lib/kelly-calculator';
import { useBankroll } from '@/hooks/useBankroll';
import { DollarSign, TrendingUp, AlertTriangle, Calculator, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ParlayKellyCalculatorProps {
  legs: Array<{
    hit_rate_over?: number;
    hit_rate_under?: number;
    recommended_side?: string;
    over_price?: number;
    under_price?: number;
  }>;
  correlatedProbability?: number;
  totalOdds?: number;
  compact?: boolean;
}

export function ParlayKellyCalculator({ 
  legs, 
  correlatedProbability,
  totalOdds,
  compact = false 
}: ParlayKellyCalculatorProps) {
  const { settings } = useBankroll();
  
  const { kellyResult, varianceMetrics, legData } = useMemo(() => {
    const bankroll = settings?.bankrollAmount || 1000;
    const multiplier = settings?.kellyMultiplier || 0.5;
    
    // Convert legs to kelly format
    const processedLegs = legs.map(leg => {
      const side = leg.recommended_side || 'over';
      const hitRate = side === 'over' ? (leg.hit_rate_over || 0.5) : (leg.hit_rate_under || 0.5);
      const odds = side === 'over' ? (leg.over_price || -110) : (leg.under_price || -110);
      
      return {
        winProbability: hitRate,
        decimalOdds: americanToDecimal(odds)
      };
    });

    // Use correlated probability if provided, otherwise calculate
    const combinedOdds = totalOdds || processedLegs.reduce((acc, leg) => acc * leg.decimalOdds, 1);
    
    // Apply correlation discount
    const correlationFactor = correlatedProbability 
      ? correlatedProbability / processedLegs.reduce((acc, leg) => acc * leg.winProbability, 1)
      : 0.85;

    const result = calculateParlayKelly(processedLegs, bankroll, multiplier, Math.min(correlationFactor, 1));
    
    const variance = calculateVariance(
      correlatedProbability || processedLegs.reduce((acc, leg) => acc * leg.winProbability, 1) * correlationFactor,
      result.recommendedStake,
      combinedOdds,
      bankroll
    );

    return {
      kellyResult: result,
      varianceMetrics: variance,
      legData: processedLegs
    };
  }, [legs, correlatedProbability, totalOdds, settings]);

  const formatStake = (amount: number) => {
    if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
    return `$${amount.toFixed(0)}`;
  };

  const getRiskColor = () => {
    switch (kellyResult.riskLevel) {
      case 'conservative': return 'text-chart-2 bg-chart-2/10 border-chart-2/30';
      case 'moderate': return 'text-chart-4 bg-chart-4/10 border-chart-4/30';
      case 'aggressive': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'reckless': return 'text-destructive bg-destructive/10 border-destructive/30';
    }
  };

  if (kellyResult.edge <= 0) {
    return compact ? (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted/30">
        No Edge
      </Badge>
    ) : (
      <Card className="bg-muted/20 border-border/30">
        <CardContent className="py-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">No positive edge detected - Kelly suggests no bet</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className={cn('text-xs gap-1 border', getRiskColor())}>
                <DollarSign className="h-3 w-3" />
                {formatStake(kellyResult.recommendedStake)}
              </Badge>
              <Badge variant="outline" className="text-xs gap-1 text-chart-2 bg-chart-2/10 border-chart-2/30">
                <TrendingUp className="h-3 w-3" />
                +{(kellyResult.edge).toFixed(1)}% edge
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px]">
            <div className="space-y-1 text-xs">
              <p className="font-medium">Parlay Kelly Analysis</p>
              <p>Stake: {formatStake(kellyResult.recommendedStake)} ({(kellyResult.adjustedKellyFraction * 100).toFixed(2)}%)</p>
              <p>Edge: +{kellyResult.edge.toFixed(1)}%</p>
              <p>EV: {kellyResult.expectedValue > 0 ? '+' : ''}${kellyResult.expectedValue.toFixed(2)}</p>
              <p>Risk of Ruin: {varianceMetrics.riskOfRuin.toFixed(1)}%</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Card className="bg-card/60 border-border/50">
      <CardContent className="py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Kelly Stake Calculator</span>
          </div>
          <Badge variant="outline" className={cn('gap-1 border', getRiskColor())}>
            {kellyResult.riskLevel.charAt(0).toUpperCase() + kellyResult.riskLevel.slice(1)}
          </Badge>
        </div>

        {/* Stake Options */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded-lg bg-muted/30 border border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1">Full Kelly</p>
            <p className="text-sm font-bold">{formatStake(kellyResult.recommendedStake * 2)}</p>
            <p className="text-[10px] text-orange-400">High Risk</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-chart-2/10 border border-chart-2/30">
            <p className="text-[10px] text-muted-foreground mb-1">Half Kelly ✓</p>
            <p className="text-sm font-bold text-chart-2">{formatStake(kellyResult.recommendedStake)}</p>
            <p className="text-[10px] text-chart-2">Recommended</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30 border border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1">Quarter Kelly</p>
            <p className="text-sm font-bold">{formatStake(kellyResult.recommendedStake / 2)}</p>
            <p className="text-[10px] text-muted-foreground">Conservative</p>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/30">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-chart-2" />
            <div>
              <p className="text-[10px] text-muted-foreground">Edge</p>
              <p className="text-sm font-medium text-chart-2">+{kellyResult.edge.toFixed(1)}%</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-chart-2" />
            <div>
              <p className="text-[10px] text-muted-foreground">Expected Value</p>
              <p className="text-sm font-medium text-chart-2">
                +${kellyResult.expectedValue.toFixed(2)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-chart-4" />
            <div>
              <p className="text-[10px] text-muted-foreground">Risk of Ruin</p>
              <p className="text-sm font-medium">{varianceMetrics.riskOfRuin.toFixed(1)}%</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-[10px] text-muted-foreground">Bankroll %</p>
              <p className="text-sm font-medium">{(kellyResult.adjustedKellyFraction * 100).toFixed(2)}%</p>
            </div>
          </div>
        </div>

        {/* Warning */}
        {kellyResult.warning && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-chart-4/10 border border-chart-4/20">
            <AlertTriangle className="h-4 w-4 text-chart-4 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-chart-4">{kellyResult.warning}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
