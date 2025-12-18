import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DollarSign, TrendingUp } from 'lucide-react';
import { calculateKelly, americanToDecimal } from '@/lib/kelly-calculator';
import { cn } from '@/lib/utils';

interface BankrollSettings {
  bankrollAmount?: number;
  kellyMultiplier?: number;
  maxBetPercent?: number;
}

interface MiniKellyIndicatorProps {
  winProbability: number; // 0-1
  americanOdds: number;
  bankrollSettings?: BankrollSettings | null;
}

export function MiniKellyIndicator({ winProbability, americanOdds, bankrollSettings }: MiniKellyIndicatorProps) {
  const kellyResult = useMemo(() => {
    const bankroll = bankrollSettings?.bankrollAmount || 1000;
    const multiplier = bankrollSettings?.kellyMultiplier || 0.5;
    const maxBetPercent = bankrollSettings?.maxBetPercent || 5;
    
    return calculateKelly({
      winProbability,
      decimalOdds: americanToDecimal(americanOdds),
      bankroll,
      kellyMultiplier: multiplier,
      maxBetPercent: maxBetPercent / 100
    });
  }, [winProbability, americanOdds, bankrollSettings]);

  const getRiskColor = () => {
    switch (kellyResult.riskLevel) {
      case 'conservative': return 'text-chart-2 bg-chart-2/10 border-chart-2/30';
      case 'moderate': return 'text-chart-4 bg-chart-4/10 border-chart-4/30';
      case 'aggressive': return 'text-destructive bg-destructive/10 border-destructive/30';
      default: return 'text-muted-foreground bg-muted/10 border-muted/30';
    }
  };

  const formatStake = (amount: number) => {
    if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
    return `$${amount.toFixed(0)}`;
  };

  if (kellyResult.edge <= 0) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground border-muted/30">
        No Edge
      </Badge>
    );
  }

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
              +{(kellyResult.edge * 100).toFixed(1)}%
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-[200px]">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Kelly Criterion Analysis</p>
            <p>Recommended: {formatStake(kellyResult.recommendedStake)} ({(kellyResult.adjustedKellyFraction * 100).toFixed(1)}%)</p>
            <p>Edge: +{(kellyResult.edge * 100).toFixed(1)}%</p>
            <p>EV: {kellyResult.expectedValue > 0 ? '+' : ''}{kellyResult.expectedValue.toFixed(2)}</p>
            <p className="capitalize">Risk: {kellyResult.riskLevel}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
