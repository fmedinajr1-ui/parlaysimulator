import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, RefreshCw, Loader2, TrendingUp, Zap } from "lucide-react";
import { usePredictionParlays, PredictionParlay } from "@/hooks/usePredictionParlays";

const SPORT_EMOJI: Record<string, string> = {
  NBA: "🏀",
  MLB: "⚾",
  NHL: "🏒",
  NCAAB: "🏀",
  NFL: "🏈",
};

function formatPropType(propType: string): string {
  return propType
    .replace(/_/g, " ")
    .replace(/player /i, "")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function PredictionParlayCard({ parlay }: { parlay: PredictionParlay }) {
  const { leg1, leg2 } = parlay;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-card to-card/80 overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              2-Leg Prediction
            </span>
          </div>
          <div className="flex items-center gap-1">
            {parlay.sports.map((sport) => (
              <Badge key={sport} variant="outline" className="text-[10px] px-1.5 py-0">
                {SPORT_EMOJI[sport] || "🎯"} {sport}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2">
        {/* Legs */}
        {[leg1, leg2].map((leg, idx) => (
          <div
            key={leg.id}
            className="flex items-center justify-between bg-muted/30 rounded-lg px-2.5 py-2 border border-border/30"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{leg.player_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {leg.prediction}
              </p>
            </div>
            <div className="flex items-center gap-1.5 ml-2 shrink-0">
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20"
              >
                {Math.round(leg.signal_accuracy * 100)}% acc
              </Badge>
            </div>
          </div>
        ))}

        {/* Stats row */}
        <div className="flex items-center justify-between pt-1 border-t border-border/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <TrendingUp className="h-3 w-3" />
              {Math.round(parlay.combined_accuracy * 100)}% combined
            </span>
            <span>•</span>
            <span className="flex items-center gap-0.5">
              <Zap className="h-3 w-3" />
              {Math.round(parlay.combined_confidence)} conf
            </span>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 ${
              parlay.strategy === "cross-sport"
                ? "border-chart-4/40 text-chart-4"
                : "border-chart-2/40 text-chart-2"
            }`}
          >
            {parlay.strategy === "cross-sport" ? "🌐 Cross-Sport" : "🏟️ Same Sport"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export function PredictionParlaysSection() {
  const { parlays, signalStats, isLoading, error, refresh } = usePredictionParlays();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  if (isLoading && parlays.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Prediction 2-Leg Parlays</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <Card key={i} className="border-primary/10">
              <CardContent className="p-3 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-4 w-48" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Prediction 2-Leg Parlays</h3>
          {parlays.length > 0 && (
            <Badge variant="default" className="bg-primary/20 text-primary text-[10px]">
              {parlays.length} pairs
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-7 px-2 text-xs"
        >
          {isRefreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </Button>
      </div>

      {/* Signal accuracy overview */}
      {signalStats.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {signalStats.slice(0, 5).map((s) => (
            <Badge
              key={s.signal_type}
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-border/50"
            >
              {s.signal_type}: {s.accuracy}% ({s.sample_size})
            </Badge>
          ))}
        </div>
      )}

      {error && parlays.length === 0 ? (
        <Card className="border-border/30">
          <CardContent className="py-6 text-center">
            <Target className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="mt-3">
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : parlays.length === 0 ? (
        <Card className="border-border/30">
          <CardContent className="py-6 text-center">
            <Target className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              No qualifying 2-leg pairs yet today
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {parlays.map((parlay) => (
            <PredictionParlayCard key={parlay.id} parlay={parlay} />
          ))}
        </div>
      )}
    </div>
  );
}
