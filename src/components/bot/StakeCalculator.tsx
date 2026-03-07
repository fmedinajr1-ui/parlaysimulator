import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, Target, TrendingUp } from "lucide-react";

// Half-Kelly formula: f* = (p*b - q) / b / 2
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

// Proven strategy data from live performance (9-day track record)
const STRATEGIES = [
  { name: "Mispriced Edge", winRate: 0.336, roi: 67.6, avgOdds: "+600", volume: "8-10/day" },
  { name: "Grind Stack", winRate: 0.353, roi: 109.7, avgOdds: "+500", volume: "3-5/day" },
  { name: "Cross Sport 4-Leg", winRate: 1.0, roi: 755.8, avgOdds: "+800", volume: "3-5/day" },
  { name: "Mega Lottery", winRate: 0.333, roi: 889.9, avgOdds: "+2000", volume: "2/day" },
  { name: "Exploration Mix", winRate: 0.35, roi: 150, avgOdds: "+700", volume: "5-8/day" },
];

// Pre-computed stake plans at common bankroll levels
const BANKROLL_PLANS = [
  { bankroll: 1000, execution: 20, validation: 10, exploration: 5, lottery: 2, dailyEV: 85, monthlyEV: 1700 },
  { bankroll: 2500, execution: 50, validation: 25, exploration: 10, lottery: 5, dailyEV: 212, monthlyEV: 4240 },
  { bankroll: 5000, execution: 100, validation: 50, exploration: 20, lottery: 10, dailyEV: 425, monthlyEV: 8500 },
  { bankroll: 10000, execution: 200, validation: 100, exploration: 40, lottery: 20, dailyEV: 850, monthlyEV: 17000 },
  { bankroll: 25000, execution: 500, validation: 250, exploration: 100, lottery: 50, dailyEV: 2125, monthlyEV: 42500 },
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
