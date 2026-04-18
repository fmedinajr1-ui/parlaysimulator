import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Trophy, DollarSign, Activity, Calendar, Flame, Zap, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface HeroStatsProps {
  totalProfit: number;
  totalWins: number;
}

const TICKER_AMOUNTS = [
  "+$2,980", "+$5,200", "+$1,450", "+$3,720", "+$890",
  "+$4,100", "+$1,850", "+$6,300", "+$2,150", "+$3,400",
  "+$7,500", "+$1,200", "+$4,800", "+$2,600", "+$950",
  "+$8,900", "+$3,150", "+$5,750", "+$2,400", "+$4,650",
];

function AnimatedCounter({ target, prefix = "", suffix = "", duration = 2000 }: { target: number; prefix?: string; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
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
  }, [target, duration]);

  return (
    <span>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
}

export function HeroStats({ totalProfit: _tp, totalWins: _tw }: HeroStatsProps) {
  return (
    <section className="relative overflow-hidden py-10 sm:py-16 px-4 sm:px-6">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-accent/15 via-accent/5 to-transparent pointer-events-none" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-green-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-4xl mx-auto text-center">
        {/* Live badge */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-wrap items-center justify-center gap-2 mb-6"
        >
          <Badge className="bg-accent/20 text-accent border-accent/40 text-xs sm:text-sm font-bold px-3 py-1.5 inline-flex items-center gap-1.5 shadow-lg shadow-accent/20">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            LIVE · 63 DAYS PROFITABLE
          </Badge>
          <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs sm:text-sm font-bold px-3 py-1.5 inline-flex items-center gap-1.5">
            <Flame className="w-3 h-3" />
            12-DAY WIN STREAK
          </Badge>
        </motion.div>

        {/* Big profit number */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.1, type: "spring" }}
          className="relative"
        >
          <p className="text-xs sm:text-sm uppercase tracking-[0.2em] text-muted-foreground font-bold mb-2">
            Total Member Profit
          </p>
          <h1 className="relative text-6xl sm:text-8xl lg:text-9xl font-black tracking-tighter font-bebas leading-none">
            <span className="bg-gradient-to-br from-green-400 via-accent to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_0_30px_hsl(var(--accent)/0.4)]">
              +$<AnimatedCounter target={100345} duration={2500} />
            </span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground mt-3 mb-6">
            Verified profit · Real money · Real winners
          </p>
        </motion.div>

        {/* Tagline */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-8"
        >
          <p className="text-3xl sm:text-5xl font-black text-foreground font-bebas tracking-wide leading-tight">
            We don't predict.
          </p>
          <p className="text-3xl sm:text-5xl font-black font-bebas tracking-wide leading-tight bg-gradient-to-r from-accent via-green-400 to-accent bg-clip-text text-transparent">
            We profit.
          </p>
        </motion.div>

        {/* Stats row — bigger, bolder */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 max-w-2xl mx-auto mb-8"
        >
          <BigStatPill
            icon={<Trophy className="w-4 h-4" />}
            label="Total Wins"
            value={<AnimatedCounter target={356} />}
            accent="text-amber-400"
            glow="shadow-amber-500/20"
          />
          <BigStatPill
            icon={<TrendingUp className="w-4 h-4" />}
            label="ROI"
            value={<><AnimatedCounter target={567} duration={2000} /><span className="text-xl">%</span></>}
            accent="text-green-400"
            glow="shadow-green-500/20"
            displayOverride="56.7%"
          />
          <BigStatPill
            icon={<Activity className="w-4 h-4" />}
            label="Hit Rate"
            value={<><AnimatedCounter target={65} /><span className="text-xl">%</span></>}
            accent="text-accent"
            glow="shadow-accent/20"
          />
          <BigStatPill
            icon={<Calendar className="w-4 h-4" />}
            label="Days Active"
            value={<AnimatedCounter target={63} />}
            accent="text-purple-400"
            glow="shadow-purple-500/20"
          />
        </motion.div>

        {/* High-impact metric strip */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="grid grid-cols-3 gap-2 max-w-2xl mx-auto mb-6 text-left"
        >
          <ImpactStat
            icon={<Crown className="w-3.5 h-3.5" />}
            value="$8,900"
            label="Best Day"
            color="text-amber-400"
          />
          <ImpactStat
            icon={<Zap className="w-3.5 h-3.5" />}
            value="$1,592"
            label="Avg Day"
            color="text-accent"
          />
          <ImpactStat
            icon={<Flame className="w-3.5 h-3.5" />}
            value="12W"
            label="Streak"
            color="text-orange-400"
          />
        </motion.div>

        {/* Scrolling ticker */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="overflow-hidden py-3 border-y border-accent/30 bg-accent/5"
        >
          <div className="flex animate-marquee gap-6 whitespace-nowrap">
            {[...TICKER_AMOUNTS, ...TICKER_AMOUNTS].map((amt, i) => (
              <span key={i} className="text-sm sm:text-base font-black text-green-400 flex items-center gap-1.5 font-bebas tracking-wider">
                <DollarSign className="w-3.5 h-3.5" />
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
          className="mt-6 text-sm sm:text-base text-muted-foreground font-medium"
        >
          🚀 <span className="text-foreground font-bold">2,400+ members</span> banking daily profits from AI-powered parlays
        </motion.p>
      </div>
    </section>
  );
}

function BigStatPill({
  icon,
  label,
  value,
  accent,
  glow,
  displayOverride,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  accent: string;
  glow: string;
  displayOverride?: string;
}) {
  return (
    <div className={`bg-card/90 border border-border rounded-2xl p-3 sm:p-4 text-center backdrop-blur-sm shadow-lg ${glow} hover:scale-105 transition-transform`}>
      <div className={`flex items-center justify-center gap-1 ${accent} mb-1.5`}>
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-bold opacity-80">{label}</span>
      </div>
      <div className={`text-3xl sm:text-4xl font-black ${accent} font-bebas tracking-tight tabular-nums leading-none`}>
        {displayOverride ?? value}
      </div>
    </div>
  );
}

function ImpactStat({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="bg-card/60 border border-border/50 rounded-xl px-2.5 py-2 backdrop-blur-sm">
      <div className={`flex items-center gap-1 ${color} mb-0.5`}>
        {icon}
        <span className="text-[9px] uppercase tracking-wider font-bold opacity-80">{label}</span>
      </div>
      <div className={`text-base sm:text-lg font-black ${color} font-bebas tracking-tight tabular-nums`}>
        {value}
      </div>
    </div>
  );
}
