import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Check, TrendingUp, ChevronDown, ChevronUp } from "lucide-react";
import { StatsCard } from "@/components/ui/stats-card";

interface Winner {
  playerName: string;
  propType: string;
  side: string;
  line: number;
  actualValue: number;
  confidence: number;
  hitRate: number;
}

interface DailyWinnersData {
  date: string;
  winners: Winner[];
  totalHits: number;
  totalPicks: number;
  hitRate: number;
  propBreakdown: Record<string, { hits: number; total: number; rate: number }>;
}

const propIcons: Record<string, string> = {
  POINTS: "🏀",
  PTS: "🏀",
  REBOUNDS: "💪",
  REB: "💪",
  ASSISTS: "🎯",
  AST: "🎯",
  THREES: "🔥",
  THREE_POINTERS: "🔥",
  "3PT": "🔥",
  STEALS: "🖐️",
  STL: "🖐️",
  BLOCKS: "🛡️",
  BLK: "🛡️",
  PRA: "⭐",
};

const propLabels: Record<string, string> = {
  POINTS: "PTS",
  PTS: "PTS",
  REBOUNDS: "REB",
  REB: "REB",
  ASSISTS: "AST",
  AST: "AST",
  THREES: "3PT",
  THREE_POINTERS: "3PT",
  "3PT": "3PT",
  STEALS: "STL",
  STL: "STL",
  BLOCKS: "BLK",
  BLK: "BLK",
  PRA: "PRA",
};

export function DailyWinnersShowcase() {
  const [data, setData] = useState<DailyWinnersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchWinners() {
      try {
        const { data: result, error } = await supabase.functions.invoke("bot-daily-winners");
        if (error) throw error;
        if (result?.winners?.length > 0) {
          setData(result);
        }
      } catch (err) {
        console.error("Error fetching daily winners:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchWinners();
  }, []);

  if (loading || !data || data.winners.length === 0) return null;

  const displayDate = new Date(data.date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const visibleWinners = expanded ? data.winners : data.winners.slice(0, 6);
  const breakdownEntries = Object.entries(data.propBreakdown).sort((a, b) => b[1].rate - a[1].rate);

  return (
    <section className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-1 bg-accent rounded-full" />
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">
            Yesterday's Winners
          </h2>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
            {displayDate}
          </span>
        </div>

        {/* Summary bar */}
        <StatsCard variant="highlight" className="mb-6">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8">
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-accent">
                {data.totalHits}/{data.totalPicks}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Picks Hit
              </p>
            </div>
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-accent">
                {data.hitRate}%
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Hit Rate
              </p>
            </div>
            <div className="hidden sm:flex flex-wrap gap-2 ml-auto">
              {breakdownEntries.map(([prop, stats]) => {
                const icon = propIcons[prop] || "📊";
                const label = propLabels[prop] || prop;
                return (
                  <span
                    key={prop}
                    className="inline-flex items-center gap-1 text-xs bg-muted/60 px-2 py-1 rounded-full text-foreground"
                  >
                    {icon} {label}: {stats.hits}/{stats.total} ({stats.rate}%)
                  </span>
                );
              })}
            </div>
          </div>

          {/* Mobile prop breakdown */}
          <div className="flex flex-wrap gap-2 mt-3 sm:hidden">
            {breakdownEntries.map(([prop, stats]) => {
              const icon = propIcons[prop] || "📊";
              const label = propLabels[prop] || prop;
              return (
                <span
                  key={prop}
                  className="inline-flex items-center gap-1 text-xs bg-muted/60 px-2 py-1 rounded-full text-foreground"
                >
                  {icon} {label}: {stats.hits}/{stats.total}
                </span>
              );
            })}
          </div>
        </StatsCard>
      </motion.div>

      {/* Winner cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <AnimatePresence>
          {visibleWinners.map((winner, i) => {
            const icon = propIcons[winner.propType.toUpperCase()] || "📊";
            const label = propLabels[winner.propType.toUpperCase()] || winner.propType;
            const sideLabel = (winner.side || "over").toUpperCase().charAt(0);

            return (
              <motion.div
                key={`${winner.playerName}-${winner.propType}-${i}`}
                initial={{ opacity: 0, y: 16, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, delay: i * 0.06 }}
              >
                <StatsCard variant="glass" className="flex items-center gap-3 py-3 px-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center">
                    <Check className="w-4 h-4 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {winner.playerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {icon} {sideLabel}{winner.line} {label}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-accent flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {winner.actualValue}
                    </p>
                    <p className="text-[10px] text-muted-foreground uppercase">Actual</p>
                  </div>
                </StatsCard>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Expand/collapse */}
      {data.winners.length > 6 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={() => setExpanded(!expanded)}
          className="mt-4 mx-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <>Show less <ChevronUp className="w-4 h-4" /></>
          ) : (
            <>Show all {data.winners.length} winners <ChevronDown className="w-4 h-4" /></>
          )}
        </motion.button>
      )}
    </section>
  );
}
