import { FeedCard } from "../FeedCard";
import { 
  Activity, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Coffee,
  Flame,
  BarChart3
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  calculateVariance, 
  analyzeTilt, 
  americanToDecimal 
} from "@/lib/kelly-calculator";
import { useBankroll } from "@/hooks/useBankroll";
import { useMemo } from "react";

interface VarianceWarningCardProps {
  winProbability: number;
  americanOdds: number;
  stake: number;
  delay?: number;
}

export function VarianceWarningCard({ 
  winProbability, 
  americanOdds, 
  stake,
  delay = 0 
}: VarianceWarningCardProps) {
  const { settings, getDrawdownPercent } = useBankroll();
  
  const bankroll = settings?.bankrollAmount ?? 1000;
  const decimalOdds = americanToDecimal(americanOdds);
  const potentialWin = stake * (decimalOdds - 1);

  const varianceMetrics = useMemo(() => {
    return calculateVariance(winProbability, stake, decimalOdds, bankroll);
  }, [winProbability, stake, decimalOdds, bankroll]);

  const tiltAnalysis = useMemo(() => {
    if (!settings) return null;
    return analyzeTilt(
      settings.currentWinStreak,
      settings.currentLossStreak,
      stake,
      settings.bankrollAmount,
      settings.peakBankroll
    );
  }, [settings, stake]);

  const drawdownPercent = getDrawdownPercent();

  // Calculate position on the outcome range slider
  const rangeWidth = varianceMetrics.bestCase95 - varianceMetrics.worstCase95;
  const zeroPosition = rangeWidth > 0 
    ? ((0 - varianceMetrics.worstCase95) / rangeWidth) * 100 
    : 50;

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Variance Analysis
        </p>
        {varianceMetrics.sharpeRatio > 0.5 ? (
          <Badge variant="outline" className="text-neon-green bg-neon-green/10">
            Good Sharpe
          </Badge>
        ) : varianceMetrics.sharpeRatio > 0 ? (
          <Badge variant="outline" className="text-amber-500 bg-amber-500/10">
            Thin Edge
          </Badge>
        ) : (
          <Badge variant="outline" className="text-neon-red bg-neon-red/10">
            Negative EV
          </Badge>
        )}
      </div>

      {/* Outcome Range Visualization */}
      <div className="mb-6 p-4 rounded-xl bg-muted/30">
        <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
          🎲 Expected Outcome Range (95% confidence):
        </p>
        
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-neon-red font-medium">
            {varianceMetrics.worstCase95 >= 0 ? '+' : ''}${varianceMetrics.worstCase95.toFixed(2)}
          </span>
          <span className="text-muted-foreground">$0</span>
          <span className="text-neon-green font-medium">
            +${varianceMetrics.bestCase95.toFixed(2)}
          </span>
        </div>

        {/* Visual bar */}
        <div className="relative h-4 rounded-full bg-gradient-to-r from-neon-red/30 via-muted to-neon-green/30 overflow-hidden">
          {/* Zero marker */}
          <div 
            className="absolute top-0 h-full w-0.5 bg-foreground/40"
            style={{ left: `${Math.max(0, Math.min(100, zeroPosition))}%` }}
          />
          {/* Expected value marker */}
          <div 
            className="absolute top-0 h-full w-1 bg-neon-cyan rounded"
            style={{ 
              left: `${Math.max(0, Math.min(100, ((varianceMetrics.expectedReturn - varianceMetrics.worstCase95) / rangeWidth) * 100))}%` 
            }}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-2">
          ▲ Expected: {varianceMetrics.expectedReturn >= 0 ? '+' : ''}${varianceMetrics.expectedReturn.toFixed(2)}
        </p>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <BarChart3 className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
          <p className="text-lg font-bold">{varianceMetrics.sharpeRatio.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <TrendingDown className="w-4 h-4 mx-auto mb-1 text-amber-500" />
          <p className="text-lg font-bold">{varianceMetrics.maxDrawdownRisk.toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground">Max DD Risk</p>
        </div>
        <div className="text-center p-3 rounded-lg bg-muted/50">
          <Activity className="w-4 h-4 mx-auto mb-1 text-neon-cyan" />
          <p className="text-lg font-bold">${varianceMetrics.standardDeviation.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground">Std Dev</p>
        </div>
      </div>

      {/* Risk of Ruin */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-muted-foreground">Risk of Ruin (100 bets)</span>
          <span className={varianceMetrics.riskOfRuin > 20 ? 'text-neon-red' : 'text-muted-foreground'}>
            {varianceMetrics.riskOfRuin.toFixed(1)}%
          </span>
        </div>
        <Progress 
          value={Math.min(varianceMetrics.riskOfRuin, 100)} 
          className="h-2"
        />
      </div>

      {/* Tilt Alert */}
      {tiltAnalysis?.isTilting && (
        <div className="p-4 rounded-xl bg-neon-red/10 border border-neon-red/20 mb-4">
          <div className="flex items-start gap-3">
            <Flame className="w-5 h-5 text-neon-red shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-neon-red">
                🔥 TILT ALERT
              </p>
              <p className="text-sm text-foreground mt-1">
                {tiltAnalysis.tiltReason}
              </p>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <Coffee className="w-3 h-3" />
                {tiltAnalysis.suggestedAction}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Streak Info */}
      {settings && (settings.currentWinStreak > 0 || settings.currentLossStreak > 0) && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          {settings.currentWinStreak > 0 ? (
            <>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-neon-green" />
                <span className="text-sm">
                  {settings.currentWinStreak} win streak
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Stay disciplined!
              </span>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-neon-red" />
                <span className="text-sm">
                  {settings.currentLossStreak} loss streak
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                Consider reducing stakes
              </span>
            </>
          )}
        </div>
      )}

      {/* Drawdown Warning */}
      {drawdownPercent > 10 && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-sm text-amber-500">
              {drawdownPercent.toFixed(1)}% below peak bankroll
            </p>
          </div>
        </div>
      )}
    </FeedCard>
  );
}
