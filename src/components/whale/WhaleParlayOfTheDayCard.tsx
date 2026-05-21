import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Anchor, Sparkles, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface WhaleLeg {
  whale_pick_id?: string;
  sport?: string | null;
  player_name?: string | null;
  prop_type?: string | null;
  side?: string | null;
  line?: number | null;
  price?: number | null;
  tier?: string | null;
  whale_score?: number | null;
  signal_types?: string[];
  why?: string | null;
  game?: string | null;
  commence_time?: string | null;
}

interface WhaleParlay {
  id: string;
  created_at: string;
  legs: WhaleLeg[];
  total_odds: number | null;
  confidence_score: number | null;
  signals_used: string[] | null;
  ai_reasoning: string | null;
}

function formatProp(prop?: string | null): string {
  if (!prop) return "";
  return prop
    .replace(/^player_|^batter_|^pitcher_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function decimalToAmerican(dec: number): string {
  if (!Number.isFinite(dec) || dec <= 1) return "—";
  const am = dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
  return am > 0 ? `+${am}` : `${am}`;
}

export function WhaleParlayOfTheDayCard() {
  const [parlay, setParlay] = useState<WhaleParlay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("ai_generated_parlays")
        .select("id,created_at,legs,total_odds,confidence_score,signals_used,ai_reasoning")
        .eq("strategy_used", "whale_parlay_of_the_day")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = data?.[0];
      if (row) {
        setParlay({
          id: row.id,
          created_at: row.created_at,
          legs: (row.legs as unknown as WhaleLeg[]) ?? [],
          total_odds: row.total_odds,
          confidence_score: row.confidence_score,
          signals_used: row.signals_used,
          ai_reasoning: row.ai_reasoning,
        });
      } else {
        setParlay(null);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!parlay || parlay.legs.length === 0) {
    return (
      <Card className="border-dashed border-border/60 bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Anchor className="w-4 h-4 text-primary" />
            Whale Parlay of the Day
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No whale parlay yet. The smart whale engine builds today's pick once it
          spots enough Tier-S/A line movement.
        </CardContent>
      </Card>
    );
  }

  const totalOdds = parlay.total_odds ?? 0;

  return (
    <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Anchor className="w-4 h-4 text-primary" />
            Whale Parlay of the Day
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
              {parlay.legs.length} LEG
            </Badge>
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 text-[10px]">
              {decimalToAmerican(totalOdds)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {parlay.legs.map((leg, idx) => (
          <div
            key={leg.whale_pick_id ?? idx}
            className="rounded-lg border border-border/40 bg-background/60 p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5">
                    {leg.sport ?? "—"}
                  </Badge>
                  {leg.tier && (
                    <Badge
                      className={`text-[9px] py-0 px-1.5 ${
                        leg.tier === "S"
                          ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                          : leg.tier === "A"
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                          : "bg-sky-500/20 text-sky-400 border-sky-500/40"
                      }`}
                    >
                      Tier {leg.tier}
                    </Badge>
                  )}
                  {typeof leg.whale_score === "number" && (
                    <span className="text-[10px] text-muted-foreground">
                      {leg.whale_score}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-foreground truncate">
                  {leg.player_name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {leg.side?.toUpperCase()} {leg.line ?? ""} {formatProp(leg.prop_type)}
                </div>
                {leg.why && (
                  <div className="mt-1.5 flex items-start gap-1 text-[11px] text-primary/90">
                    <TrendingUp className="w-3 h-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{leg.why}</span>
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-mono text-foreground">
                  {leg.price ? decimalToAmerican(leg.price) : "—"}
                </div>
              </div>
            </div>
          </div>
        ))}
        {parlay.confidence_score != null && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/30">
            <span>Avg whale score: {parlay.confidence_score}</span>
            <span>{new Date(parlay.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}