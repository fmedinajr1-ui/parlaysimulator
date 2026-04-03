import { useParlayAccuracy, ParlayAccuracyRow } from "@/hooks/useParlayAccuracy";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Trophy, Target, AlertTriangle, TrendingUp, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface ParlayAccuracyCardProps {
  daysBack: number;
}

function WinRateBadge({ rate, confidence }: { rate: number | null; confidence: string }) {
  if (rate === null) return <span className="text-xs text-muted-foreground">N/A</span>;
  const color =
    rate >= 30 ? "text-chart-2" : rate >= 20 ? "text-chart-4" : "text-destructive";
  return (
    <div className="flex items-center gap-1">
      <span className={cn("text-sm font-bold", color)}>{rate}%</span>
      {confidence === "insufficient" && (
        <span className="text-[10px] text-muted-foreground">(low n)</span>
      )}
    </div>
  );
}

function ProfitBadge({ profit }: { profit: number }) {
  const isPositive = profit >= 0;
  return (
    <span className={cn("text-xs font-semibold", isPositive ? "text-chart-2" : "text-destructive")}>
      {isPositive ? "+" : ""}${Math.abs(profit).toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
}

function BreakdownRow({ row }: { row: ParlayAccuracyRow }) {
  const settled = row.wins + row.losses;
  return (
    <div className="flex items-center justify-between py-1.5 text-xs border-b border-border/30 last:border-0">
      <span className="text-foreground font-medium truncate max-w-[140px]">{row.label}</span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{settled} settled</span>
        <WinRateBadge rate={row.winRate} confidence={row.sampleConfidence} />
        <ProfitBadge profit={row.netProfit} />
      </div>
    </div>
  );
}

export function ParlayAccuracyCard({ daysBack }: ParlayAccuracyCardProps) {
  const { overall, byTier, byLegCount, byStrategy, isLoading } = useParlayAccuracy(daysBack);
  const [tierOpen, setTierOpen] = useState(false);
  const [legOpen, setLegOpen] = useState(false);
  const [stratOpen, setStratOpen] = useState(false);

  if (isLoading) {
    return (
      <Card className="border-border/50 animate-pulse">
        <CardContent className="p-4 h-32" />
      </Card>
    );
  }

  if (!overall) return null;

  const settled = overall.wins + overall.losses;

  return (
    <Card className="border-border/50">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold">Parlay Accuracy</span>
          </div>
          <WinRateBadge rate={overall.winRate} confidence={overall.sampleConfidence} />
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-lg font-bold text-foreground">{overall.wins}/{settled}</div>
            <div className="text-[10px] text-muted-foreground">Won / Settled</div>
          </div>
          <div className="text-center">
            <div className={cn("text-lg font-bold", overall.missBy1Pct && overall.missBy1Pct > 40 ? "text-destructive" : "text-chart-4")}>
              {overall.missBy1Pct ?? 0}%
            </div>
            <div className="text-[10px] text-muted-foreground">Miss-by-1</div>
          </div>
          <div className="text-center">
            <ProfitBadge profit={overall.netProfit} />
            <div className="text-[10px] text-muted-foreground mt-0.5">Net Profit</div>
          </div>
        </div>

        {/* Win rate bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Win Rate</span>
            <span>{overall.winRate ?? 0}% of {settled} settled</span>
          </div>
          <Progress value={overall.winRate ?? 0} className="h-2" />
        </div>

        {/* By Tier */}
        <Collapsible open={tierOpen} onOpenChange={setTierOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
            <div className="flex items-center gap-1.5">
              <Layers className="w-3 h-3" />
              <span className="font-medium">By Tier</span>
            </div>
            <ChevronDown className={cn("w-3 h-3 transition-transform", tierOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {byTier.map((row) => (
              <BreakdownRow key={row.label} row={row} />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* By Leg Count */}
        <Collapsible open={legOpen} onOpenChange={setLegOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3" />
              <span className="font-medium">By Leg Count</span>
            </div>
            <ChevronDown className={cn("w-3 h-3 transition-transform", legOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {byLegCount.filter(r => (r.wins + r.losses) > 0).map((row) => (
              <BreakdownRow key={row.label} row={row} />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* By Strategy */}
        <Collapsible open={stratOpen} onOpenChange={setStratOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" />
              <span className="font-medium">Top Strategies</span>
            </div>
            <ChevronDown className={cn("w-3 h-3 transition-transform", stratOpen && "rotate-180")} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {byStrategy.slice(0, 10).map((row) => (
              <BreakdownRow key={row.label} row={row} />
            ))}
          </CollapsibleContent>
        </Collapsible>

        {/* Miss-by-1 Warning */}
        {overall.missBy1Pct && overall.missBy1Pct > 40 && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-destructive">
              {overall.missBy1} of {overall.losses} losses failed by exactly 1 leg ({overall.missBy1Pct}%).
              Gold Signal Engine gates are targeting this leak.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
