import { TrendingUp, Trophy, Calendar, DollarSign } from "lucide-react";

interface HeroStatsProps {
  totalProfit: number;
  winRate: number;
  daysActive: number;
  totalWins: number;
  totalLosses: number;
}

export function HeroStats({ totalProfit, winRate, daysActive, totalWins, totalLosses }: HeroStatsProps) {
  return (
    <section className="relative overflow-hidden py-16 px-4 sm:px-6">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent pointer-events-none" />
      
      <div className="relative max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-sm font-medium mb-6">
          <TrendingUp className="w-4 h-4" />
          Live Performance Tracker
        </div>
        
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground mb-4 font-bebas tracking-wide">
          AI-Powered Daily Parlays
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
          Our bot generates multiple parlays daily using proprietary scoring models, 
          real-time odds data, and machine learning — then tracks every result transparently.
        </p>

        {/* Key stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<DollarSign className="w-5 h-5" />}
            label="Total Profit"
            value={`${totalProfit >= 0 ? '+' : ''}$${Math.abs(totalProfit).toLocaleString()}`}
            color={totalProfit >= 0 ? 'text-accent' : 'text-destructive'}
          />
          <StatCard
            icon={<Trophy className="w-5 h-5" />}
            label="Win Rate"
            value={`${winRate}%`}
            color="text-primary"
          />
          <StatCard
            icon={<Calendar className="w-5 h-5" />}
            label="Days Active"
            value={daysActive.toString()}
            color="text-secondary"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="Record"
            value={`${totalWins}W - ${totalLosses}L`}
            color="text-foreground"
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-2xl sm:text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
