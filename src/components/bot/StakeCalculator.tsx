import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, TrendingUp } from "lucide-react";

// Half-Kelly formula: f* = (p*b - q) / b / 2
// where p = win probability, q = 1-p, b = decimal odds - 1
function halfKelly(bankroll: number, winRate: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const q = 1 - winRate;
  const f = (winRate * b - q) / b;
  const halfF = Math.max(0, f / 2);
  return Math.round(bankroll * halfF);
}

const TIERS = [
  { label: "Execution", winRate: 0.37, odds: 7.0, parlaysPerDay: 5, key: "execution" },
  { label: "Validation", winRate: 0.33, odds: 8.0, parlaysPerDay: 8, key: "validation" },
  { label: "Exploration", winRate: 0.30, odds: 9.0, parlaysPerDay: 10, key: "exploration" },
  { label: "Bankroll Doubler", winRate: 0.15, odds: 50.0, parlaysPerDay: 2, key: "bankroll_doubler" },
];

export function StakeCalculator() {
  const [bankroll, setBankroll] = useState(5000);

  const tiers = TIERS.map((t) => {
    const stake = halfKelly(bankroll, t.winRate, t.odds);
    const wins = t.parlaysPerDay * t.winRate;
    const losses = t.parlaysPerDay * (1 - t.winRate);
    const dailyEV = wins * stake * (t.odds - 1) - losses * stake;
    return { ...t, stake, dailyEV };
  });

  const totalDailyEV = tiers.reduce((s, t) => s + t.dailyEV, 0);
  const totalMonthlyEV = totalDailyEV * 20;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Live Stake Calculator
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter your bankroll — optimal stakes are calculated using the Half-Kelly formula
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <Label>Your Bankroll</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              className="pl-7"
              value={bankroll}
              onChange={(e) => setBankroll(Number(e.target.value))}
              min={100}
              step={500}
            />
          </div>
        </div>

        <div className="space-y-3">
          {tiers.map((tier) => (
            <div key={tier.key} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30">
              <div>
                <p className="text-sm font-semibold">{tier.label}</p>
                <p className="text-xs text-muted-foreground">
                  {tier.parlaysPerDay} parlays/day · {(tier.winRate * 100).toFixed(0)}% WR · +{Math.round((tier.odds - 1) * 100)} avg odds
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">${tier.stake.toLocaleString()}/parlay</p>
                <p className={`text-xs ${tier.dailyEV >= 0 ? "text-primary" : "text-destructive"}`}>
                  {tier.dailyEV >= 0 ? "+" : ""}${Math.round(tier.dailyEV).toLocaleString()}/day EV
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4 grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Projected Daily</div>
            <div className={`text-xl font-bold ${totalDailyEV >= 0 ? "text-primary" : "text-destructive"}`}>
              {totalDailyEV >= 0 ? "+" : ""}${Math.round(totalDailyEV).toLocaleString()}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Monthly (20 days)</div>
            <div className={`text-xl font-bold ${totalMonthlyEV >= 0 ? "text-primary" : "text-destructive"}`}>
              {totalMonthlyEV >= 0 ? "+" : ""}${Math.round(totalMonthlyEV).toLocaleString()}
            </div>
          </div>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          Half-Kelly sizing · Conservative bankroll management · Based on actual 9-day performance
        </p>
      </CardContent>
    </Card>
  );
}
