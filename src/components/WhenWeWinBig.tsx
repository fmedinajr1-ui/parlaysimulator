import { Link } from "react-router-dom";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

const scenarios = [
  {
    tier: "EXECUTION",
    legs: 3,
    odds: 596,
    stake: 500,
    winRate: 0.37,
    count: 3,
    badgeClass: "bg-primary/20 text-primary border-primary/30",
    profitColor: "text-primary",
  },
  {
    tier: "VALIDATION",
    legs: 4,
    odds: 1228,
    stake: 200,
    winRate: 0.22,
    count: 5,
    badgeClass: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    profitColor: "text-yellow-400",
  },
  {
    tier: "EXPLORATION",
    legs: 3,
    odds: 596,
    stake: 75,
    winRate: 0.37,
    count: 8,
    badgeClass: "bg-muted/50 text-muted-foreground border-border",
    profitColor: "text-primary",
  },
];

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function WhenWeWinBig() {
  return (
    <FeedCard variant="neon" className="bg-gradient-to-br from-primary/5 to-accent/5">
      {/* Header */}
      <div className="flex items-start gap-3 mb-5">
        <span className="text-2xl leading-none mt-1">🔥</span>
        <div>
          <h2 className="font-display text-2xl sm:text-3xl tracking-wider text-foreground leading-tight">
            WHEN WE WIN, WE WIN BIG
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs text-muted-foreground uppercase tracking-widest">
              Live picks active · One hit changes your week
            </span>
          </div>
        </div>
      </div>

      {/* Payout Cards */}
      <div className="flex flex-col gap-3 mb-5">
        {scenarios.map((s) => {
          const profit = Math.round(s.stake * (s.odds / 100));
          const totalReturn = s.stake + profit;
          const ev = Math.round(s.count * (s.winRate * profit - (1 - s.winRate) * s.stake));

          return (
            <div
              key={s.tier}
              className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-4 flex flex-col gap-2"
            >
              {/* Top row */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Badge className={`text-xs font-bold px-2 py-0.5 border ${s.badgeClass}`}>
                  {s.tier}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {s.legs}-Leg Parlay · <span className="font-semibold text-foreground">+{s.odds}</span> odds
                </span>
              </div>

              {/* Big profit number */}
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className={`text-3xl font-black tracking-tight ${s.profitColor}`}>
                    +${fmt(profit)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ${fmt(s.stake)} stake → ${fmt(totalReturn)} return
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground">Win rate</div>
                  <div className="text-sm font-bold text-foreground">{Math.round(s.winRate * 100)}%</div>
                </div>
              </div>

              {/* EV line */}
              <div className="text-xs text-primary/80 font-medium">
                EV: +${fmt(ev)}/day across {s.count} parlays
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <Link to="/best-bets" className="block">
        <Button
          variant="neon"
          size="lg"
          className="w-full font-display text-base tracking-wider animate-pulse-glow"
        >
          <Trophy className="w-4 h-4" />
          🎯 See Today's Picks
        </Button>
      </Link>
    </FeedCard>
  );
}
