import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Check, TrendingUp } from "lucide-react";
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

const tierColors: Record<string, string> = {
  execution: "bg-primary/20 text-primary border-primary/30",
  validation: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  exploration: "bg-accent/20 text-accent border-accent/30",
  lottery: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  bankroll_doubler: "bg-accent/20 text-accent border-accent/30",
};

function fmt(n: number) {
  return Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
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

  return (
    <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-8 w-1 bg-accent rounded-full" />
        <h2 className="text-xl sm:text-2xl font-bold text-foreground font-bebas tracking-wide">
          💰 RECENT WINS
        </h2>
        <Badge className="bg-accent/15 text-accent border-accent/30 text-xs animate-pulse">
          LIVE
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {wins.map((win, i) => {
          const tierKey = (win.tier || "").toLowerCase().replace(/\s+/g, "_");
          const badgeClass = tierColors[tierKey] || tierColors.execution;
          const displayDate = new Date(win.date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });

          return (
            <motion.div
              key={win.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="rounded-xl border border-accent/20 bg-card/80 backdrop-blur-sm p-4 hover:border-accent/40 transition-colors"
              style={{ boxShadow: "0 0 20px hsl(var(--accent) / 0.08)" }}
            >
              <div className="flex items-center justify-between mb-2">
                <Badge className={`text-[10px] font-bold px-2 py-0.5 border ${badgeClass}`}>
                  {(win.tier || "PARLAY").toUpperCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{displayDate}</span>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl sm:text-3xl font-black text-accent tracking-tight">
                    +${fmt(win.profit)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ${fmt(win.stake)} → ${fmt(win.stake + win.profit)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-accent">
                    <Check className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">{win.legsHit}/{win.legCount}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">+{win.odds}</div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
