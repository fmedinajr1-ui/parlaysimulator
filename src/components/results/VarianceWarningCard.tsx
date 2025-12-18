import { FeedCard } from "../FeedCard";
import { 
  Activity, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  Coffee,
  Flame,
  BarChart3,
  Sparkles,
  Target
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
import { PerformanceSparkline } from "./PerformanceSparkline";

interface VarianceWarningCardProps {
  winProbability: number;
  americanOdds: number;
  stake: number;
  delay?: number;
  recentPerformances?: number[];
  line?: number;
}

interface IQRMetrics {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  consistencyScore: number;
}

function calculateIQR(data: number[]): IQRMetrics | null {
  if (!data || data.length < 5) return null;
  
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  
  const q1Index = Math.floor(n * 0.25);
  const medianIndex = Math.floor(n * 0.5);
  const q3Index = Math.floor(n * 0.75);
  
  const q1 = sorted[q1Index];
  const median = sorted[medianIndex];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  
  // Consistency score: lower IQR relative to median = more consistent
  const avgPerf = data.reduce((a, b) => a + b, 0) / data.length;
  const consistencyScore = avgPerf > 0 ? Math.max(0, 100 - (iqr / avgPerf) * 100) : 50;
  
  return { q1, median, q3, iqr, consistencyScore };
}

function getStakeRecommendation(
  sharpeRatio: number, 
  riskOfRuin: number, 
  consistencyScore: number | null,
  edge: number
): { recommendation: string; kellyFraction: string; color: string; shouldSkip: boolean } {
  // High variance + marginal edge = skip or reduce
  if (edge < 3 && consistencyScore !== null && consistencyScore < 50) {
    return {
      recommendation: "SKIP or reduce to 1/8 Kelly",
      kellyFraction: "1/8",
      color: "text-neon-red",
      shouldSkip: true
    };
  }
  
  if (sharpeRatio < 0) {
    return {
      recommendation: "Skip this bet - negative expected value",
      kellyFraction: "0",
      color: "text-neon-red",
      shouldSkip: true
    };
  }
  
  if (riskOfRuin > 30 || sharpeRatio < 0.2) {
    return {
      recommendation: "Reduce to Quarter Kelly",
      kellyFraction: "1/4",
      color: "text-amber-500",
      shouldSkip: false
    };
  }
  
  if (sharpeRatio < 0.5 || (consistencyScore !== null && consistencyScore < 60)) {
    return {
      recommendation: "Recommend Half Kelly",
      kellyFraction: "1/2",
      color: "text-neon-cyan",
      shouldSkip: false
    };
  }
  
  return {
    recommendation: "Full Kelly appropriate",
    kellyFraction: "1",
    color: "text-neon-green",
    shouldSkip: false
  };
}

export function VarianceWarningCard({ 
  winProbability, 
  americanOdds, 
  stake,
  delay = 0,
  recentPerformances,
  line
}: VarianceWarningCardProps) {
  const { settings, getDrawdownPercent } = useBankroll();
  
  const bankroll = settings?.bankrollAmount ?? 1000;
  const decimalOdds = americanToDecimal(americanOdds);

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

  const iqrMetrics = useMemo(() => {
    return calculateIQR(recentPerformances || []);
  }, [recentPerformances]);

  const edge = useMemo(() => {
    const impliedProb = 1 / decimalOdds;
    return (winProbability - impliedProb) * 100;
  }, [winProbability, decimalOdds]);

  const stakeRecommendation = useMemo(() => {
    return getStakeRecommendation(
      varianceMetrics.sharpeRatio,
      varianceMetrics.riskOfRuin,
      iqrMetrics?.consistencyScore ?? null,
      edge
    );
  }, [varianceMetrics, iqrMetrics, edge]);

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

      {/* Stake Recommendation Banner */}
      <div className={`p-3 rounded-xl mb-4 ${
        stakeRecommendation.shouldSkip 
          ? 'bg-neon-red/10 border border-neon-red/20' 
          : stakeRecommendation.kellyFraction === "1/4"
            ? 'bg-amber-500/10 border border-amber-500/20'
            : stakeRecommendation.kellyFraction === "1/2"
              ? 'bg-neon-cyan/10 border border-neon-cyan/20'
              : 'bg-neon-green/10 border border-neon-green/20'
      }`}>
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${stakeRecommendation.color}`} />
          <p className={`text-sm font-medium ${stakeRecommendation.color}`}>
            {stakeRecommendation.recommendation}
          </p>
        </div>
        {stakeRecommendation.shouldSkip && (
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            High variance + marginal edge suggests caution
          </p>
        )}
      </div>

      {/* Performance Sparkline */}
      {recentPerformances && recentPerformances.length >= 5 && (
        <div className="mb-6 p-4 rounded-xl bg-muted/30">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Last {recentPerformances.length} Performances
          </p>
          <PerformanceSparkline 
            data={recentPerformances} 
            threshold={line}
            height={60}
          />
          
          {/* IQR Display */}
          {iqrMetrics && (
            <div className="grid grid-cols-4 gap-2 mt-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Q1</p>
                <p className="text-sm font-medium">{iqrMetrics.q1.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Median</p>
                <p className="text-sm font-medium text-neon-cyan">{iqrMetrics.median.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Q3</p>
                <p className="text-sm font-medium">{iqrMetrics.q3.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">IQR</p>
                <p className="text-sm font-medium">{iqrMetrics.iqr.toFixed(1)}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Consistency Score */}
      {iqrMetrics && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Player Consistency</span>
            <span className={
              iqrMetrics.consistencyScore >= 70 ? 'text-neon-green' :
              iqrMetrics.consistencyScore >= 50 ? 'text-amber-500' : 'text-neon-red'
            }>
              {iqrMetrics.consistencyScore.toFixed(0)}%
            </span>
          </div>
          <Progress 
            value={iqrMetrics.consistencyScore} 
            className="h-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {iqrMetrics.consistencyScore >= 70 
              ? "Consistent performer - good for props" 
              : iqrMetrics.consistencyScore >= 50
                ? "Moderate variance - consider stakes"
                : "High variance - reduce exposure"}
          </p>
        </div>
      )}

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
