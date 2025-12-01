import { FeedCard } from "../FeedCard";
import { LegAnalysis } from "@/types/parlay";
import { Activity, TrendingUp, TrendingDown, AlertTriangle, Shield } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ParlayHealthCardProps {
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

const TRAP_SIGNALS = [
  'BOTH_SIDES_MOVED',
  'PRICE_ONLY_MOVE_TRAP',
  'SINGLE_BOOK_DIVERGENCE',
  'EARLY_MORNING_OVER',
  'FAKE_SHARP_TAG'
];

export function ParlayHealthCard({ legAnalyses, delay = 0 }: ParlayHealthCardProps) {
  if (!legAnalyses || legAnalyses.length === 0) return null;

  // Calculate sharp analysis stats
  const pickLegs = legAnalyses.filter(la => la.sharpRecommendation === 'pick').length;
  const fadeLegs = legAnalyses.filter(la => la.sharpRecommendation === 'fade').length;
  const cautionLegs = legAnalyses.filter(la => la.sharpRecommendation === 'caution').length;
  const noDataLegs = legAnalyses.filter(la => !la.sharpRecommendation || la.sharpRecommendation === null).length;
  const trapAlerts = legAnalyses.filter(la => 
    la.sharpRecommendation === 'fade' && 
    la.sharpSignals?.some(s => TRAP_SIGNALS.includes(s))
  ).length;

  // Calculate health score (0-100)
  // PICK = +20 points, FADE = -15 points, TRAP = -25 points, CAUTION = -5 points
  const totalLegs = legAnalyses.length;
  const rawScore = (pickLegs * 20) - (fadeLegs * 15) - (trapAlerts * 10) - (cautionLegs * 5);
  const maxPossibleScore = totalLegs * 20;
  const healthScore = Math.max(0, Math.min(100, ((rawScore + maxPossibleScore) / (maxPossibleScore * 2)) * 100));

  // Determine health status
  let healthStatus: 'excellent' | 'good' | 'fair' | 'poor' | 'danger';
  let healthColor: string;
  let healthEmoji: string;
  let healthLabel: string;

  if (healthScore >= 80) {
    healthStatus = 'excellent';
    healthColor = 'text-neon-green';
    healthEmoji = '🔥';
    healthLabel = 'EXCELLENT';
  } else if (healthScore >= 60) {
    healthStatus = 'good';
    healthColor = 'text-neon-green';
    healthEmoji = '✅';
    healthLabel = 'GOOD';
  } else if (healthScore >= 40) {
    healthStatus = 'fair';
    healthColor = 'text-neon-yellow';
    healthEmoji = '⚠️';
    healthLabel = 'FAIR';
  } else if (healthScore >= 20) {
    healthStatus = 'poor';
    healthColor = 'text-neon-orange';
    healthEmoji = '🚨';
    healthLabel = 'POOR';
  } else {
    healthStatus = 'danger';
    healthColor = 'text-neon-red';
    healthEmoji = '💀';
    healthLabel = 'DANGER';
  }

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-foreground" />
        <span className="text-sm font-bold uppercase tracking-wider">Parlay Health Score</span>
      </div>

      {/* Health Score Display */}
      <div className="mb-4 p-4 bg-muted/50 rounded-lg border border-border/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase">Overall Health</span>
          <span className={`text-2xl font-bold ${healthColor}`}>
            {healthScore.toFixed(0)}%
          </span>
        </div>
        <Progress value={healthScore} className="h-2 mb-2" />
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">{healthEmoji}</span>
          <span className={`text-sm font-bold ${healthColor}`}>{healthLabel}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* PICK Legs */}
        <div className="p-3 bg-neon-green/10 rounded-lg border border-neon-green/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-neon-green" />
            <span className="text-xs font-medium text-neon-green uppercase">Pick Legs</span>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-2xl font-bold text-neon-green">{pickLegs}</span>
            <span className="text-xs text-muted-foreground mb-0.5">/ {totalLegs}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Sharp money backing</p>
        </div>

        {/* FADE Legs */}
        <div className="p-3 bg-neon-red/10 rounded-lg border border-neon-red/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-neon-red" />
            <span className="text-xs font-medium text-neon-red uppercase">Fade Legs</span>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-2xl font-bold text-neon-red">{fadeLegs}</span>
            <span className="text-xs text-muted-foreground mb-0.5">/ {totalLegs}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Potential traps</p>
        </div>

        {/* Trap Alerts */}
        <div className="p-3 bg-neon-orange/10 rounded-lg border border-neon-orange/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-neon-orange" />
            <span className="text-xs font-medium text-neon-orange uppercase">Trap Alerts</span>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-2xl font-bold text-neon-orange">{trapAlerts}</span>
            <span className="text-xs text-muted-foreground mb-0.5">detected</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Fake sharp signals</p>
        </div>

        {/* Caution/No Data */}
        <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Neutral</span>
          </div>
          <div className="flex items-end gap-1">
            <span className="text-2xl font-bold text-foreground">{cautionLegs + noDataLegs}</span>
            <span className="text-xs text-muted-foreground mb-0.5">legs</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">Mixed or no data</p>
        </div>
      </div>

      {/* Recommendation */}
      <div className={`p-3 rounded-lg ${
        healthStatus === 'excellent' || healthStatus === 'good' 
          ? 'bg-neon-green/10 border border-neon-green/30' 
          : healthStatus === 'fair'
          ? 'bg-neon-yellow/10 border border-neon-yellow/30'
          : 'bg-neon-red/10 border border-neon-red/30'
      }`}>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">💡 Recommendation:</span>{' '}
          {healthStatus === 'excellent' && 'Strong sharp backing! This parlay looks solid.'}
          {healthStatus === 'good' && 'Mostly positive signals. Proceed with confidence.'}
          {healthStatus === 'fair' && 'Mixed signals. Review fade legs carefully before betting.'}
          {healthStatus === 'poor' && 'Multiple concerns detected. Consider removing fade legs.'}
          {healthStatus === 'danger' && 'High risk of trap bets. Strongly consider rebuilding this parlay.'}
        </p>
      </div>
    </FeedCard>
  );
}
