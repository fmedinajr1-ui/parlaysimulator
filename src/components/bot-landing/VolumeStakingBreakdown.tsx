import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { BarChart3, Shield, TrendingUp, Zap, Target, Layers, Sparkles } from "lucide-react";

// Half-Kelly formula from StakeCalculator
function halfKelly(bankroll: number, winRate: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const q = 1 - winRate;
  const f = (winRate * b - q) / b;
  const halfF = Math.max(0, f / 2);
  return Math.round(bankroll * halfF);
}

const TIERS = [
  { label: "Execution", winRate: 0.37, odds: 7.0, parlaysPerDay: 5, icon: Zap, color: "text-primary" },
  { label: "Validation", winRate: 0.33, odds: 8.0, parlaysPerDay: 8, icon: Shield, color: "text-chart-2" },
  { label: "Exploration", winRate: 0.30, odds: 9.0, parlaysPerDay: 10, icon: Target, color: "text-chart-4" },
  { label: "Lottery", winRate: 0.15, odds: 50.0, parlaysPerDay: 2, icon: Sparkles, color: "text-accent" },
];

const BANKROLL_PLANS = [
  { bankroll: 1000, dailyEV: 85, monthlyEV: 1700 },
  { bankroll: 2500, dailyEV: 212, monthlyEV: 4240 },
  { bankroll: 5000, dailyEV: 425, monthlyEV: 8500 },
  { bankroll: 10000, dailyEV: 850, monthlyEV: 17000 },
  { bankroll: 25000, dailyEV: 2125, monthlyEV: 42500 },
];

const CONCEPTS = [
  {
    icon: Layers,
    title: "20+ Parlays/Day",
    description: "Diversified volume across 4 tiers reduces variance and smooths out daily swings.",
  },
  {
    icon: Shield,
    title: "Half-Kelly Sizing",
    description: "Math-based stakes protect your bankroll while maximizing expected value on every bet.",
  },
  {
    icon: TrendingUp,
    title: "Compounding Edge",
    description: "Even a 30% win rate at +500 odds compounds into a profitable month, every month.",
  },
];

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const ref = useRef<number>();

  useEffect(() => {
    const start = value;
    const diff = target - start;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(start + diff * eased));
      if (progress < 1) ref.current = requestAnimationFrame(tick);
    }

    ref.current = requestAnimationFrame(tick);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [target, duration]);

  return value;
}

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0, 0, 0.2, 1] as const },
  }),
};

const tableRow = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0, 0, 0.2, 1] as const },
  }),
};

export function VolumeStakingBreakdown() {
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

  const animatedDaily = useCountUp(Math.round(totalDailyEV));
  const animatedMonthly = useCountUp(Math.round(totalMonthlyEV));

  return (
    <section className="px-4 py-12 space-y-10 overflow-hidden">
      {/* Headline */}
      <motion.div
        className="text-center space-y-3"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
        variants={fadeUp}
        custom={0}
      >
        <h2 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
          How Volume Staking Turns the Odds
        </h2>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          Our bot spreads risk across 20+ daily parlays using math-based sizing — turning a 30% win rate into consistent profit.
        </p>
      </motion.div>

      {/* Concept Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CONCEPTS.map((concept, i) => (
          <motion.div
            key={concept.title}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-30px" }}
            variants={fadeUp}
            custom={i + 1}
          >
            <Card className="h-full border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:scale-[1.03] hover:border-primary/40 hover:shadow-[0_0_25px_hsl(var(--primary)/0.12)]">
              <CardContent className="p-5 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <concept.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{concept.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{concept.description}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Interactive Bankroll Slider */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-30px" }}
        variants={fadeUp}
        custom={4}
      >
        <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5">
          <CardContent className="p-6 space-y-6">
            <div className="text-center space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Your Bankroll</p>
              <p className="text-3xl font-bold text-foreground">${bankroll.toLocaleString()}</p>
            </div>

            <div className="px-2">
              <Slider
                value={[bankroll]}
                onValueChange={(v) => setBankroll(v[0])}
                min={500}
                max={25000}
                step={500}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>$500</span>
                <span>$25,000</span>
              </div>
            </div>

            {/* Tier Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {tiers.map((tier, i) => (
                <motion.div
                  key={tier.label}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  variants={fadeUp}
                  custom={i}
                >
                  <div className="rounded-xl border border-border/50 bg-background/60 p-3 text-center space-y-1.5 transition-all duration-200 hover:border-primary/30">
                    <tier.icon className={`h-4 w-4 mx-auto ${tier.color}`} />
                    <p className="text-xs font-semibold text-foreground">{tier.label}</p>
                    <p className="text-sm font-bold text-foreground">${tier.stake}/bet</p>
                    <p className={`text-[10px] font-medium ${tier.dailyEV >= 0 ? "text-chart-2" : "text-destructive"}`}>
                      {tier.dailyEV >= 0 ? "+" : ""}${Math.round(tier.dailyEV)}/day
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Projected Totals */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Projected Daily</p>
                <p className="text-2xl font-bold text-chart-2">
                  +${animatedDaily.toLocaleString()}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Monthly (20 days)</p>
                <p className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">
                  +${animatedMonthly.toLocaleString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Reference Table */}
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-30px" }}
        variants={fadeUp}
        custom={0}
      >
        <div className="space-y-3">
          <h3 className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Quick Reference by Bankroll
          </h3>
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground text-xs">Bankroll</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground text-xs">Daily EV</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground text-xs">Monthly</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground text-xs">ROI</th>
                </tr>
              </thead>
              <tbody>
                {BANKROLL_PLANS.map((plan, i) => (
                  <motion.tr
                    key={plan.bankroll}
                    className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    variants={tableRow}
                    custom={i}
                  >
                    <td className="py-2.5 px-4 font-semibold text-foreground">${plan.bankroll.toLocaleString()}</td>
                    <td className="text-right py-2.5 px-4 text-chart-2 font-medium">+${plan.dailyEV.toLocaleString()}</td>
                    <td className="text-right py-2.5 px-4 font-bold text-primary">+${plan.monthlyEV.toLocaleString()}</td>
                    <td className="text-right py-2.5 px-4 text-accent font-medium">
                      {Math.round((plan.monthlyEV / plan.bankroll) * 100)}%
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* Trust Footer */}
      <motion.p
        className="text-center text-[11px] text-muted-foreground animate-pulse"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={fadeUp}
        custom={0}
        style={{ animationDuration: "3s" }}
      >
        Based on live performance data · Half-Kelly conservative sizing · Past performance not guaranteed
      </motion.p>
    </section>
  );
}
