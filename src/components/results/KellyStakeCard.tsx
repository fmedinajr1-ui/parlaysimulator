import { FeedCard } from "../FeedCard";
import { 
  Calculator, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Target,
  Shield,
  Wallet,
  Info
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { 
  calculateKelly, 
  americanToDecimal, 
  compareToKelly,
  validateKellyInputs,
  type KellyResult 
} from "@/lib/kelly-calculator";
import { useBankroll } from "@/hooks/useBankroll";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";

interface KellyStakeCardProps {
  winProbability: number;
  americanOdds: number;
  userStake?: number;
  delay?: number;
}

const KELLY_OPTIONS = [
  { value: 1.0, label: 'Full Kelly', risk: 'High Risk' },
  { value: 0.5, label: 'Half Kelly', risk: 'Recommended' },
  { value: 0.25, label: 'Quarter Kelly', risk: 'Conservative' },
];

export function KellyStakeCard({ 
  winProbability, 
  americanOdds, 
  userStake = 0,
  delay = 0 
}: KellyStakeCardProps) {
  const { settings, isLoading } = useBankroll();
  const [selectedMultiplier, setSelectedMultiplier] = useState(0.5);

  const bankroll = settings?.bankrollAmount ?? 0;
  const decimalOdds = americanOdds !== 0 ? americanToDecimal(americanOdds) : 0;

  // Validate inputs
  const validation = useMemo(() => {
    return validateKellyInputs({
      winProbability,
      decimalOdds,
      bankroll,
      kellyMultiplier: selectedMultiplier,
      maxBetPercent: settings?.maxBetPercent ?? 0.05
    });
  }, [winProbability, decimalOdds, bankroll, selectedMultiplier, settings?.maxBetPercent]);

  const kellyResult = useMemo<KellyResult | null>(() => {
    if (!validation.isValid) return null;
    return calculateKelly({
      winProbability,
      decimalOdds,
      bankroll,
      kellyMultiplier: selectedMultiplier,
      maxBetPercent: settings?.maxBetPercent ?? 0.05
    });
  }, [validation.isValid, winProbability, decimalOdds, bankroll, selectedMultiplier, settings?.maxBetPercent]);

  const comparison = useMemo(() => {
    if (userStake > 0 && kellyResult) {
      return compareToKelly(userStake, kellyResult.recommendedStake);
    }
    return null;
  }, [userStake, kellyResult]);

  const riskColorMap = {
    conservative: 'text-neon-green',
    moderate: 'text-neon-cyan',
    aggressive: 'text-amber-500',
    reckless: 'text-neon-red'
  };

  const riskBgMap = {
    conservative: 'bg-neon-green/10',
    moderate: 'bg-neon-cyan/10',
    aggressive: 'bg-amber-500/10',
    reckless: 'bg-neon-red/10'
  };

  if (isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-8 bg-muted rounded" />
        </div>
      </FeedCard>
    );
  }

  // Show bankroll setup prompt if no bankroll
  if (!bankroll || bankroll < 10) {
    return (
      <FeedCard delay={delay}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Kelly Stake Calculator
          </p>
        </div>
        <div className="text-center py-6">
          <Wallet className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <h3 className="font-semibold mb-2">Set Up Your Bankroll</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Configure your bankroll to get personalized stake recommendations
          </p>
          <Link to="/kelly">
            <Button>
              <Wallet className="w-4 h-4 mr-2" />
              Configure Bankroll
            </Button>
          </Link>
        </div>
      </FeedCard>
    );
  }

  // Show validation errors
  if (!validation.isValid) {
    return (
      <FeedCard delay={delay}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Kelly Stake Calculator
          </p>
          <Badge variant="outline" className="text-amber-500 bg-amber-500/10">
            INCOMPLETE DATA
          </Badge>
        </div>
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-500">Missing Information</p>
              <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                {validation.errors.map((error, i) => (
                  <li key={i}>• {error}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </FeedCard>
    );
  }

  if (!kellyResult) return null;

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Kelly Stake Calculator
        </p>
        <Badge 
          variant="outline" 
          className={`${riskColorMap[kellyResult.riskLevel]} ${riskBgMap[kellyResult.riskLevel]}`}
        >
          {kellyResult.riskLevel.toUpperCase()}
        </Badge>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="text-center p-4 rounded-xl bg-muted/50">
          <p className="text-xs text-muted-foreground uppercase mb-1">Your Bankroll</p>
          <p className="text-2xl font-bold text-foreground">${bankroll.toLocaleString()}</p>
        </div>
        <div className="text-center p-4 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20">
          <p className="text-xs text-muted-foreground uppercase mb-1">Kelly Recommends</p>
          <p className="text-2xl font-bold text-neon-cyan">
            ${kellyResult.recommendedStake.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Win Probability & Edge */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase">Win Probability</span>
          </div>
          <p className="text-lg font-semibold">{(winProbability * 100).toFixed(1)}%</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            {kellyResult.edge > 0 ? (
              <TrendingUp className="w-4 h-4 text-neon-green" />
            ) : (
              <TrendingDown className="w-4 h-4 text-neon-red" />
            )}
            <span className="text-xs text-muted-foreground uppercase">Edge</span>
          </div>
          <p className={`text-lg font-semibold ${kellyResult.edge > 0 ? 'text-neon-green' : 'text-neon-red'}`}>
            {kellyResult.edge > 0 ? '+' : ''}{kellyResult.edge.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Kelly Multiplier Selector */}
      <div className="mb-6">
        <p className="text-sm font-medium mb-3">Kelly Fraction</p>
        <RadioGroup 
          value={selectedMultiplier.toString()} 
          onValueChange={(v) => setSelectedMultiplier(parseFloat(v))}
          className="space-y-2"
        >
          {KELLY_OPTIONS.map((option) => (
            <div 
              key={option.value}
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors cursor-pointer ${
                selectedMultiplier === option.value 
                  ? 'border-neon-cyan bg-neon-cyan/5' 
                  : 'border-border hover:border-muted-foreground'
              }`}
              onClick={() => setSelectedMultiplier(option.value)}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value={option.value.toString()} id={`kelly-${option.value}`} />
                <Label htmlFor={`kelly-${option.value}`} className="cursor-pointer">
                  {option.label}: ${(bankroll * kellyResult.fullKellyFraction * option.value).toFixed(2)}
                </Label>
              </div>
              <span className={`text-xs ${
                option.risk === 'Recommended' ? 'text-neon-green' : 
                option.risk === 'High Risk' ? 'text-amber-500' : 'text-muted-foreground'
              }`}>
                ({option.risk})
              </span>
            </div>
          ))}
        </RadioGroup>
      </div>

      {/* User Stake Comparison */}
      {comparison && userStake > 0 && (
        <div className={`p-4 rounded-xl mb-4 ${
          comparison.assessment === 'optimal' ? 'bg-neon-green/10 border border-neon-green/20' :
          comparison.assessment === 'under-betting' ? 'bg-neon-cyan/10 border border-neon-cyan/20' :
          comparison.assessment === 'over-betting' ? 'bg-amber-500/10 border border-amber-500/20' :
          'bg-neon-red/10 border border-neon-red/20'
        }`}>
          <div className="flex items-start gap-2">
            {comparison.assessment === 'optimal' ? (
              <Shield className="w-5 h-5 text-neon-green shrink-0 mt-0.5" />
            ) : comparison.assessment === 'under-betting' ? (
              <TrendingDown className="w-5 h-5 text-neon-cyan shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-medium">
                Your stake (${userStake.toFixed(2)}) is {Math.abs(comparison.percentDifference).toFixed(1)}% 
                {comparison.percentDifference > 0 ? ' ABOVE' : ' BELOW'} Kelly optimal
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {comparison.advice}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Risk Meter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Risk Level</span>
          <span className={riskColorMap[kellyResult.riskLevel]}>
            {(kellyResult.adjustedKellyFraction * 100).toFixed(1)}% of bankroll
          </span>
        </div>
        <Progress 
          value={Math.min(kellyResult.adjustedKellyFraction * 100 * 10, 100)} 
          className="h-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Conservative</span>
          <span>Aggressive</span>
        </div>
      </div>

      {/* Warning */}
      {kellyResult.warning && (
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <p className="text-sm text-amber-500">{kellyResult.warning}</p>
          </div>
        </div>
      )}
    </FeedCard>
  );
}
