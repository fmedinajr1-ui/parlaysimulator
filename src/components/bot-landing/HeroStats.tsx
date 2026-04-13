import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Trophy, DollarSign, Activity, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface HeroStatsProps {
  totalProfit: number;
  totalWins: number;
}

const TICKER_AMOUNTS = [
  "+$2,980", "+$5,200", "+$1,450", "+$3,720", "+$890",
  "+$4,100", "+$1,850", "+$6,300", "+$2,150", "+$3,400",
  "+$7,500", "+$1,200", "+$4,800", "+$2,600", "+$950",
];

function AnimatedCounter({ target, prefix = "", suffix = "" }: { target: number; prefix?: string; suffix?: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const duration = 2000;
    const steps = 60;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.round(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [target]);

  return (
    <span>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
}

export function HeroStats({ totalProfit: _tp, totalWins: _tw }: HeroStatsProps) {
  return (
    <section className="relative overflow-hidden py-12 sm:py-16 px-4 sm:px-6">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-accent/8 via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-4xl mx-auto text-center">
        {/* Live badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Badge className="bg-accent/15 text-accent border-accent/30 text-sm font-semibold px-4 py-1.5 mb-6 inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            LIVE · Profitable since Feb 9
          </Badge>
        </motion.div>

        {/* Big profit number */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black text-accent tracking-tight font-bebas mb-2">
            +$<AnimatedCounter target={100345} />
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mb-8">
            Total profit generated since launch
          </p>
        </motion.div>

        {/* Tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-2xl sm:text-3xl font-bold text-foreground font-bebas tracking-wide mb-8"
        >
          We don't predict. We profit.
        </motion.p>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mb-8"
        >
          <StatPill icon={<Trophy className="w-4 h-4" />} label="Total Wins" value="356" />
          <StatPill icon={<TrendingUp className="w-4 h-4" />} label="ROI" value="56.7%" />
          <StatPill icon={<Activity className="w-4 h-4" />} label="Hit Rate" value="65%" />
          <StatPill icon={<Calendar className="w-4 h-4" />} label="Days Active" value="63" />
        </motion.div>

        {/* Scrolling ticker */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="overflow-hidden py-3 border-y border-border/40"
        >
          <div className="flex animate-marquee gap-6 whitespace-nowrap">
            {[...TICKER_AMOUNTS, ...TICKER_AMOUNTS].map((amt, i) => (
              <span key={i} className="text-sm font-bold text-accent/80 flex items-center gap-1.5">
                <DollarSign className="w-3 h-3" />
                {amt}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Social proof line */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-6 text-sm text-muted-foreground"
        >
          🚀 Join members banking daily profits from AI-powered parlays
        </motion.p>
      </div>
    </section>
  );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card/80 border border-border rounded-xl p-3 text-center backdrop-blur-sm">
      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
      </div>
      <div className="text-xl sm:text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}
