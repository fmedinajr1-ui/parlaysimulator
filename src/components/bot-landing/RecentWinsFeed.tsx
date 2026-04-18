import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Check, Trophy, Flame, TrendingUp, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface WinEntry {
  id: string;
  date: string;
  tier: string;
  odds: number;
  stake: number;
  profit: number;
  legCount: number;
  legsHit: number;
}

const tierStyles: Record<string, { label: string; class: string }> = {
  execution: { label: "EXECUTION", class: "bg-primary/15 text-primary border-primary/40" },
  validation: { label: "VALIDATION", class: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40" },
  exploration: { label: "EXPLORATION", class: "bg-accent/15 text-accent border-accent/40" },
  standard: { label: "LOTTERY", class: "bg-purple-500/15 text-purple-400 border-purple-500/40" },
  lottery: { label: "LOTTERY", class: "bg-purple-500/15 text-purple-400 border-purple-500/40" },
  bankroll_doubler: { label: "DOUBLER", class: "bg-accent/15 text-accent border-accent/40" },
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function getBadgeForProfit(profit: number) {
  if (profit >= 3000) return { icon: Trophy, label: "MEGA WIN", class: "bg-yellow-500/20 text-yellow-300 border-yellow-500/50" };
  if (profit >= 1000) return { icon: Flame, label: "BIG HIT", class: "bg-orange-500/20 text-orange-300 border-orange-500/50" };
  if (profit >= 500) return { icon: Sparkles, label: "STRONG", class: "bg-accent/20 text-accent border-accent/40" };
  return null;
}

export function RecentWinsFeed() {
  const [wins, setWins] = useState<WinEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const { data, error } = await supabase.functions.invoke("bot-recent-wins");
        if (error) throw error;
        if (data?.wins) setWins(data.wins);
      } catch (err) {
        console.error("Error fetching recent wins:", err);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  if (loading || wins.length === 0) return null;

  const totalProfit = wins.reduce((sum, w) => sum + w.profit, 0);
  const biggestWin = Math.max(...wins.map((w) => w.profit));

  return (
    <section className="px-4 sm:px-6 py-10 max-w-6xl mx-auto">
      {/* Header with summary stats */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-1 bg-gradient-to-b from-accent to-primary rounded-full" />
          <h2 className="text-xl sm:text-2xl font-bold text-foreground font-bebas tracking-wide">
            💰 BIGGEST RECENT WINS
          </h2>
          <Badge className="bg-accent/15 text-accent border-accent/40 text-[10px] animate-pulse">
            ● LIVE
          </Badge>
        </div>

        {/* Summary banner */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 rounded-xl border border-accent/30 bg-gradient-to-r from-accent/5 via-card/50 to-primary/5 backdrop-blur-sm p-3 sm:p-4">
          <div className="text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Top Wins Total</div>
            <div className="text-xl sm:text-2xl font-black text-accent tracking-tight">
              ${fmt(totalProfit)}
            </div>
          </div>
          <div className="text-center border-x border-border/40">
            <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Biggest Hit</div>
            <div className="text-xl sm:text-2xl font-black text-yellow-400 tracking-tight">
              ${fmt(biggestWin)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Win Streak</div>
            <div className="text-xl sm:text-2xl font-black text-primary tracking-tight flex items-center justify-center gap-1">
              <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
              {wins.length}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {wins.map((win, i) => {
          const tierKey = (win.tier || "").toLowerCase().replace(/\s+/g, "_");
          const tierStyle = tierStyles[tierKey] || tierStyles.execution;
          const trophyBadge = getBadgeForProfit(win.profit);
          const TrophyIcon = trophyBadge?.icon;
          const displayDate = new Date(win.date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          const multiplier = win.stake > 0 ? (win.profit / win.stake).toFixed(1) : "0";
          const isMega = win.profit >= 3000;

          return (
            <motion.div
              key={win.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className={`relative rounded-xl border p-4 backdrop-blur-sm transition-all hover:scale-[1.02] hover:border-accent/60 ${
                isMega
                  ? "border-yellow-500/40 bg-gradient-to-br from-yellow-500/5 via-card/80 to-accent/5"
                  : "border-accent/20 bg-card/80"
              }`}
              style={{
                boxShadow: isMega
                  ? "0 0 30px hsl(var(--accent) / 0.15), inset 0 0 20px hsl(45 100% 50% / 0.05)"
                  : "0 0 20px hsl(var(--accent) / 0.08)",
              }}
            >
              {/* Trophy ribbon for mega wins */}
              {trophyBadge && (
                <div className={`absolute -top-2 -right-2 flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-black tracking-wider ${trophyBadge.class}`}>
                  {TrophyIcon && <TrophyIcon className="w-3 h-3" />}
                  {trophyBadge.label}
                </div>
              )}

              {/* Top row: tier + date */}
              <div className="flex items-center justify-between mb-3">
                <Badge className={`text-[10px] font-bold px-2 py-0.5 border ${tierStyle.class}`}>
                  {tierStyle.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground font-medium">{displayDate}</span>
              </div>

              {/* Hero profit number */}
              <div className="mb-3">
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl sm:text-4xl font-black tracking-tight ${
                    isMega ? "text-yellow-400" : "text-accent"
                  }`}>
                    +${fmt(win.profit)}
                  </span>
                  <span className="text-xs font-bold text-accent/80">
                    {multiplier}x
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span>${fmt(win.stake)} stake</span>
                  <span className="text-muted-foreground/40">→</span>
                  <span className="text-foreground/80 font-semibold">${fmt(win.stake + win.profit)} payout</span>
                </div>
              </div>

              {/* Bottom row: legs + odds */}
              <div className="flex items-center justify-between pt-3 border-t border-border/40">
                <div className="flex items-center gap-1.5 text-accent">
                  <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </div>
                  <span className="text-xs font-bold">
                    {win.legsHit}/{win.legCount} legs
                  </span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <TrendingUp className="w-3 h-3" />
                  <span className="text-xs font-bold">
                    +{win.odds.toLocaleString()}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
