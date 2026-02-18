import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { AlertTriangle, TrendingUp, Award } from "lucide-react";

interface LegStat {
  leg_count: number;
  total: number;
  wins: number;
  win_rate: number;
  net_profit: number;
  avg_odds: number;
}

export function LegCountAudit() {
  const { data, isLoading } = useQuery({
    queryKey: ["leg-count-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_daily_parlays")
        .select("leg_count, outcome, profit_loss, expected_odds")
        .not("outcome", "is", null)
        .not("profit_loss", "is", null);

      if (error) throw error;

      // Group by leg count
      const grouped: Record<number, { total: number; wins: number; profit: number; odds: number[] }> = {};
      for (const row of data || []) {
        const lc = row.leg_count ?? 0;
        if (!grouped[lc]) grouped[lc] = { total: 0, wins: 0, profit: 0, odds: [] };
        grouped[lc].total++;
        if (row.outcome === "won") grouped[lc].wins++;
        grouped[lc].profit += row.profit_loss ?? 0;
        if (row.expected_odds) grouped[lc].odds.push(row.expected_odds);
      }

      return Object.entries(grouped)
        .map(([lc, s]) => ({
          leg_count: Number(lc),
          total: s.total,
          wins: s.wins,
          win_rate: s.total > 0 ? Math.round((s.wins / s.total) * 1000) / 10 : 0,
          net_profit: Math.round(s.profit),
          avg_odds: s.odds.length > 0 ? Math.round(s.odds.reduce((a, b) => a + b, 0) / s.odds.length) : 0,
        }))
        .filter((s) => s.leg_count >= 2 && s.leg_count <= 7)
        .sort((a, b) => a.leg_count - b.leg_count);
    },
  });

  const getBarColor = (stat: LegStat) => {
    if (stat.net_profit < 0) return "hsl(var(--destructive))";
    if (stat.win_rate >= 35) return "hsl(var(--primary))";
    return "hsl(var(--muted-foreground))";
  };

  const worstTier = data?.reduce((prev, curr) =>
    curr.win_rate < (prev?.win_rate ?? 100) ? curr : prev
  , data[0]);

  const bestTier = data?.reduce((prev, curr) =>
    curr.win_rate > (prev?.win_rate ?? 0) ? curr : prev
  , data[0]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leg Count Audit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Leg Count Win Rate Audit
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Real settled parlay performance by number of legs
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Alert badges */}
        <div className="flex flex-wrap gap-2">
          {worstTier && worstTier.net_profit < 0 && (
            <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 text-destructive rounded-full px-3 py-1 text-xs font-medium">
              <AlertTriangle className="h-3 w-3" />
              Kill {worstTier.leg_count}-leg parlays — ${Math.abs(worstTier.net_profit).toLocaleString()} lost ({worstTier.win_rate}% WR)
            </div>
          )}
          {bestTier && bestTier.win_rate > 30 && (
            <div className="flex items-center gap-1.5 bg-primary/10 border border-primary/30 text-primary rounded-full px-3 py-1 text-xs font-medium">
              <Award className="h-3 w-3" />
              {bestTier.leg_count}-leg is your sweet spot — {bestTier.win_rate}% win rate
            </div>
          )}
        </div>

        {/* Bar chart — win rate */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Win Rate by Leg Count</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="leg_count"
                tickFormatter={(v) => `${v}-leg`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === "win_rate" ? `${value}%` : `$${value.toLocaleString()}`,
                  name === "win_rate" ? "Win Rate" : "Net Profit",
                ]}
                labelFormatter={(label) => `${label}-leg parlays`}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="win_rate" radius={[4, 4, 0, 0]}>
                {data?.map((entry, index) => (
                  <Cell key={index} fill={getBarColor(entry)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stats table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-muted-foreground font-medium">Legs</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Parlays</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Wins</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Win Rate</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Net Profit</th>
                <th className="text-right py-2 text-muted-foreground font-medium">Avg Odds</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.leg_count} className="border-b border-border/50">
                  <td className="py-2 font-medium">{row.leg_count}-leg</td>
                  <td className="text-right py-2">{row.total}</td>
                  <td className="text-right py-2">{row.wins}</td>
                  <td className="text-right py-2">
                    <span className={row.win_rate >= 35 ? "text-primary font-semibold" : row.win_rate < 20 ? "text-destructive" : ""}>
                      {row.win_rate}%
                    </span>
                  </td>
                  <td className={`text-right py-2 font-medium ${row.net_profit >= 0 ? "text-primary" : "text-destructive"}`}>
                    {row.net_profit >= 0 ? "+" : ""}${row.net_profit.toLocaleString()}
                  </td>
                  <td className="text-right py-2 text-muted-foreground">+{row.avg_odds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
