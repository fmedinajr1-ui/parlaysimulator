import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Calculator } from "lucide-react";

interface TierConfig {
  label: string;
  stake: number;
  parlaysPerDay: number;
  winRate: number;
  avgOdds: number;
}

const DEFAULT_TIERS: TierConfig[] = [
  { label: "Execution", stake: 300, parlaysPerDay: 5, winRate: 0.37, avgOdds: 6 },
  { label: "Validation", stake: 150, parlaysPerDay: 8, winRate: 0.33, avgOdds: 7 },
  { label: "Exploration", stake: 50, parlaysPerDay: 10, winRate: 0.30, avgOdds: 8 },
];

function calcDailyEV(tier: TierConfig) {
  const wins = tier.parlaysPerDay * tier.winRate;
  const losses = tier.parlaysPerDay * (1 - tier.winRate);
  return wins * tier.stake * tier.avgOdds - losses * tier.stake;
}

function riskOfRuin(dailyStake: number, bankroll: number, winRate: number): number {
  if (winRate >= 0.5) return 0;
  const q = 1 - winRate;
  const ratio = q / winRate;
  const n = bankroll / dailyStake;
  return Math.min(100, Math.round(Math.pow(ratio, n) * 100 * 10) / 10);
}

export function DailyProfitProjector() {
  const [tiers, setTiers] = useState<TierConfig[]>(DEFAULT_TIERS);

  const updateStake = (index: number, stake: number) => {
    setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, stake } : t)));
  };

  const totalDailyEV = tiers.reduce((sum, t) => sum + calcDailyEV(t), 0);
  const totalMonthlyEV = totalDailyEV * 20;
  const totalDailyStake = tiers.reduce((sum, t) => sum + t.stake * t.parlaysPerDay, 0);
  const avgWinRate = tiers.reduce((sum, t) => sum + t.winRate, 0) / tiers.length;
  const ror = riskOfRuin(totalDailyStake, totalDailyStake * 30, avgWinRate);

  const tierColors = ["text-primary", "text-yellow-500", "text-blue-400"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Daily Profit Projector
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Adjust stakes per tier to see projected daily & monthly profit
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tier sliders */}
        <div className="space-y-5">
          {tiers.map((tier, i) => {
            const tierEV = calcDailyEV(tier);
            const wins = tier.parlaysPerDay * tier.winRate;
            const losses = tier.parlaysPerDay * (1 - tier.winRate);
            return (
              <div key={tier.label} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className={`font-semibold ${tierColors[i]}`}>{tier.label}</Label>
                  <span className="text-sm font-bold">${tier.stake}/parlay</span>
                </div>
                <Slider
                  min={25}
                  max={1000}
                  step={25}
                  value={[tier.stake]}
                  onValueChange={([v]) => updateStake(i, v)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {tier.parlaysPerDay} parlays/day · {(tier.winRate * 100).toFixed(0)}% WR · +{tier.avgOdds}x avg
                  </span>
                  <span className={tierEV >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                    Daily EV: {tierEV >= 0 ? "+" : ""}${Math.round(tierEV).toLocaleString()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground/70">
                  At ${tier.stake}: {wins.toFixed(1)} wins × ${(tier.stake * tier.avgOdds).toFixed(0)} − {losses.toFixed(1)} losses × ${tier.stake} = {tierEV >= 0 ? "+" : ""}${Math.round(tierEV).toLocaleString()}/day
                </p>
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div className="border-t border-border pt-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-muted rounded-xl p-3">
              <div className="text-xs text-muted-foreground mb-1">Projected Daily</div>
              <div className={`text-lg font-bold ${totalDailyEV >= 0 ? "text-primary" : "text-destructive"}`}>
                {totalDailyEV >= 0 ? "+" : ""}${Math.round(totalDailyEV).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <div className="text-xs text-muted-foreground mb-1">Monthly (20 days)</div>
              <div className={`text-lg font-bold ${totalMonthlyEV >= 0 ? "text-primary" : "text-destructive"}`}>
                {totalMonthlyEV >= 0 ? "+" : ""}${Math.round(totalMonthlyEV).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted rounded-xl p-3">
              <div className="text-xs text-muted-foreground mb-1">Risk of Ruin</div>
              <div className={`text-lg font-bold ${ror < 5 ? "text-primary" : ror < 15 ? "text-yellow-500" : "text-destructive"}`}>
                {ror}%
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-center text-muted-foreground">
            Total daily stake: ${totalDailyStake.toLocaleString()} across all tiers
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
