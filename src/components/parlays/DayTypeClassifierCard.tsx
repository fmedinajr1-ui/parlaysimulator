import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDayTypeClassifier, DayType, PropTypeSignal } from "@/hooks/useDayTypeClassifier";
import { Target, TrendingUp } from "lucide-react";

const DAY_TYPE_CONFIG: Record<DayType, { label: string; emoji: string; gradient: string }> = {
  POINTS: { label: "Points Day", emoji: "🔥", gradient: "from-orange-500/20 to-red-500/10" },
  THREES: { label: "Threes Day", emoji: "🎯", gradient: "from-emerald-500/20 to-green-500/10" },
  REBOUNDS: { label: "Rebounds Day", emoji: "💪", gradient: "from-blue-500/20 to-indigo-500/10" },
  ASSISTS: { label: "Assists Day", emoji: "🅰️", gradient: "from-purple-500/20 to-violet-500/10" },
  BALANCED: { label: "Balanced Slate", emoji: "⚖️", gradient: "from-primary/20 to-accent/10" },
};

const STRENGTH_COLORS: Record<PropTypeSignal["strength"], string> = {
  ELITE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  STRONG: "bg-green-500/15 text-green-400 border-green-500/30",
  MODERATE: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  WEAK: "bg-muted/30 text-muted-foreground border-border",
};

function SignalBar({ signal }: { signal: PropTypeSignal }) {
  const maxScore = 30;
  const pct = Math.min(100, (signal.avgMatchupScore / maxScore) * 100);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 font-medium">{signal.emoji} {signal.label}</span>
      <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: signal.strength === "ELITE"
              ? "linear-gradient(90deg, hsl(var(--primary)), hsl(142 76% 36%))"
              : signal.strength === "STRONG"
              ? "linear-gradient(90deg, hsl(142 76% 36%), hsl(142 70% 45%))"
              : signal.strength === "MODERATE"
              ? "linear-gradient(90deg, hsl(48 96% 53%), hsl(36 100% 50%))"
              : "hsl(var(--muted-foreground))",
          }}
        />
      </div>
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STRENGTH_COLORS[signal.strength]}`}>
        {signal.avgMatchupScore}
      </Badge>
      <span className="text-muted-foreground w-12 text-right">{signal.totalAttackVectors}v/{signal.totalGamesWithSignal}g</span>
    </div>
  );
}

export function DayTypeClassifierCard() {
  const { classification, isLoading } = useDayTypeClassifier();

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20 ml-auto" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!classification) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-3 px-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Target className="h-4 w-4" />
          <span>Day type classification unavailable — run matchup scan first</span>
        </CardContent>
      </Card>
    );
  }

  const config = DAY_TYPE_CONFIG[classification.primary];
  const topGames = classification.gameBreakdown.slice(0, 3);

  return (
    <Card className={`border-border/50 overflow-hidden bg-gradient-to-r ${config.gradient}`}>
      <CardContent className="py-3 px-4 space-y-2.5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{config.emoji}</span>
            <span className="font-bold text-sm">{config.label}</span>
            {classification.secondary && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                + {DAY_TYPE_CONFIG[classification.secondary].emoji} {DAY_TYPE_CONFIG[classification.secondary].label}
              </Badge>
            )}
          </div>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <TrendingUp className="h-3 w-3" />
            {classification.confidence}% conf
          </Badge>
        </div>

        {/* Signal bars */}
        <div className="space-y-1.5">
          {classification.signals.filter(s => s.totalAttackVectors > 0).map(signal => (
            <SignalBar key={signal.propType} signal={signal} />
          ))}
        </div>

        {/* Top matchup games */}
        {topGames.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground shrink-0">Top matchups:</span>
            {topGames.map(g => (
              <Badge key={g.gameKey} variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                {g.gameKey} <span className="text-primary">{g.score}</span>
              </Badge>
            ))}
          </div>
        )}

        {/* Summary */}
        <p className="text-[11px] text-muted-foreground leading-tight">{classification.summary}</p>
      </CardContent>
    </Card>
  );
}
