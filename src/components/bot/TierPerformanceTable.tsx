import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface TierStat {
  tier: string;
  total: number;
  wins: number;
  win_rate: number;
  net_profit: number;
  avg_odds: number;
  total_staked: number;
  roi: number;
}

const TIER_LABELS: Record<string, string> = {
  execution: "Execution",
  validation: "Validation",
  exploration: "Exploration",
  round_robin: "Bankroll Doubler",
};

const TIER_ORDER = ["execution", "validation", "exploration", "round_robin"];

export function TierPerformanceTable() {
  const { data, isLoading } = useQuery({
    queryKey: ["tier-performance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_daily_parlays")
        .select("tier, outcome, profit_loss, expected_odds, simulated_stake")
        .not("outcome", "is", null)
        .not("tier", "is", null);

      if (error) throw error;

      const grouped: Record<string, { total: number; wins: number; profit: number; odds: number[]; staked: number }> = {};

      for (const row of data || []) {
        const tier = row.tier ?? "exploration";
        if (!grouped[tier]) grouped[tier] = { total: 0, wins: 0, profit: 0, odds: [], staked: 0 };
        grouped[tier].total++;
        if (row.outcome === "won") grouped[tier].wins++;
        grouped[tier].profit += row.profit_loss ?? 0;
        if (row.expected_odds) grouped[tier].odds.push(row.expected_odds);
        grouped[tier].staked += row.simulated_stake ?? 100;
      }

      return TIER_ORDER
        .filter((t) => grouped[t])
        .map((tier) => {
          const s = grouped[tier];
          const roi = s.staked > 0 ? (s.profit / s.staked) * 100 : 0;
          return {
            tier,
            total: s.total,
            wins: s.wins,
            win_rate: s.total > 0 ? Math.round((s.wins / s.total) * 1000) / 10 : 0,
            net_profit: Math.round(s.profit),
            avg_odds: s.odds.length > 0 ? Math.round(s.odds.reduce((a, b) => a + b, 0) / s.odds.length) : 0,
            total_staked: Math.round(s.staked),
            roi: Math.round(roi * 10) / 10,
          };
        });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Tier Performance</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tier Performance Breakdown</CardTitle>
        <p className="text-sm text-muted-foreground">Live win rate, profit, and ROI per tier from all settled parlays</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data?.map((tier) => {
            const isProfit = tier.net_profit >= 0;
            const roiIcon = tier.roi > 5
              ? <TrendingUp className="h-4 w-4 text-primary" />
              : tier.roi < -5
              ? <TrendingDown className="h-4 w-4 text-destructive" />
              : <Minus className="h-4 w-4 text-muted-foreground" />;

            return (
              <div
                key={tier.tier}
                className={`rounded-xl border p-4 ${
                  isProfit
                    ? "border-primary/20 bg-primary/5"
                    : "border-destructive/20 bg-destructive/5"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {roiIcon}
                    <span className="font-semibold text-sm">{TIER_LABELS[tier.tier] ?? tier.tier}</span>
                    <span className="text-xs text-muted-foreground">({tier.total} parlays)</span>
                  </div>
                  <span className={`text-sm font-bold ${isProfit ? "text-primary" : "text-destructive"}`}>
                    {isProfit ? "+" : ""}${tier.net_profit.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                    <div className={`text-sm font-semibold ${tier.win_rate >= 35 ? "text-primary" : tier.win_rate < 20 ? "text-destructive" : ""}`}>
                      {tier.win_rate}%
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Wins / Total</div>
                    <div className="text-sm font-semibold">{tier.wins}/{tier.total}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Avg Odds</div>
                    <div className="text-sm font-semibold">+{tier.avg_odds}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">ROI</div>
                    <div className={`text-sm font-semibold ${tier.roi >= 0 ? "text-primary" : "text-destructive"}`}>
                      {tier.roi >= 0 ? "+" : ""}{tier.roi}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
