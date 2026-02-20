import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getEasternDate } from "@/lib/dateUtils";
import { SportTabs, QuickFilter } from "@/components/ui/sport-tabs";

interface MispricedLine {
  id: string;
  player_name: string;
  prop_type: string;
  book_line: number;
  player_avg_l10: number | null;
  player_avg_l20: number | null;
  edge_pct: number;
  signal: string;
  shooting_context: Record<string, any> | null;
  confidence_tier: string;
  analysis_date: string;
  sport: string;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  ELITE: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  HIGH: "bg-green-500/20 text-green-400 border-green-500/30",
  MEDIUM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  LOW: "bg-muted text-muted-foreground",
};

function formatPropType(pt: string): string {
  return pt
    .replace(/^player_/, "")
    .replace(/^batter_/, "")
    .replace(/^pitcher_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ExpandableContext({ line }: { line: MispricedLine }) {
  const [open, setOpen] = useState(false);
  const ctx = line.shooting_context;
  if (!ctx) return null;

  const isMLB = line.sport === "baseball_mlb";

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1">
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {isMLB ? "Season Stats" : "Shooting Context"}
      </button>
      {open && (
        <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-muted-foreground bg-muted/30 rounded p-1.5">
          {isMLB ? (
            <>
              <div>AVG: <span className="text-foreground font-mono">{ctx.avg?.toFixed(3) ?? "—"}</span></div>
              <div>OBP: <span className="text-foreground font-mono">{ctx.obp?.toFixed(3) ?? "—"}</span></div>
              <div>SLG: <span className="text-foreground font-mono">{ctx.slg?.toFixed(3) ?? "—"}</span></div>
              <div>OPS: <span className="text-foreground font-mono">{ctx.ops?.toFixed(3) ?? "—"}</span></div>
            </>
          ) : (
            <>
              <div>FG%: <span className="text-foreground font-mono">{ctx.fg_pct ?? "—"}</span></div>
              <div>3P%: <span className="text-foreground font-mono">{ctx.three_pct ?? "—"}</span></div>
              <div>FT%: <span className="text-foreground font-mono">{ctx.ft_pct ?? "—"}</span></div>
              <div>Games: <span className="text-foreground font-mono">{ctx.games_analyzed ?? "—"}</span></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MispricedLinesCard() {
  const [sportFilter, setSportFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [confidenceFilter, setConfidenceFilter] = useState("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: lines, isLoading, refetch } = useQuery({
    queryKey: ["mispriced-lines-display"],
    queryFn: async () => {
      const today = getEasternDate();
      const { data, error } = await supabase
        .from("mispriced_lines")
        .select("*")
        .eq("analysis_date", today)
        .order("edge_pct", { ascending: false });

      if (error) throw error;

      // Sort by abs edge descending
      return ((data || []) as unknown as MispricedLine[]).sort(
        (a, b) => Math.abs(b.edge_pct) - Math.abs(a.edge_pct)
      );
    },
    refetchInterval: 120000,
  });

  const filtered = useMemo(() => {
    if (!lines) return [];
    return lines.filter(l => {
      if (sportFilter !== "all") {
        const sportMap: Record<string, string> = { nba: "basketball_nba", mlb: "baseball_mlb" };
        if (l.sport !== sportMap[sportFilter]) return false;
      }
      if (signalFilter !== "ALL" && l.signal !== signalFilter) return false;
      if (confidenceFilter !== "ALL" && l.confidence_tier !== confidenceFilter) return false;
      return true;
    });
  }, [lines, sportFilter, signalFilter, confidenceFilter]);

  const counts = useMemo(() => {
    if (!lines) return { nba: 0, mlb: 0, over: 0, under: 0, elite: 0, high: 0, medium: 0 };
    return {
      nba: lines.filter(l => l.sport === "basketball_nba").length,
      mlb: lines.filter(l => l.sport === "baseball_mlb").length,
      over: lines.filter(l => l.signal === "OVER").length,
      under: lines.filter(l => l.signal === "UNDER").length,
      elite: lines.filter(l => l.confidence_tier === "ELITE").length,
      high: lines.filter(l => l.confidence_tier === "HIGH").length,
      medium: lines.filter(l => l.confidence_tier === "MEDIUM").length,
    };
  }, [lines]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke("detect-mispriced-lines", { body: {} });
      await refetch();
      toast.success("Mispriced lines refreshed!");
    } catch {
      toast.error("Failed to refresh mispriced lines");
    } finally {
      setIsRefreshing(false);
    }
  };

  const sportTabs = [
    { id: "all", label: "ALL", count: lines?.length || 0 },
    { id: "nba", label: "NBA", icon: "🏀", count: counts.nba },
    { id: "mlb", label: "MLB", icon: "⚾", count: counts.mlb },
  ];

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Mispriced Lines</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoading} className="h-7 w-7 p-0">
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
          {lines && lines.length > 0 && (
            <div className="text-xs text-muted-foreground">
              🏀 {counts.nba} | ⚾ {counts.mlb} | 🟢 {counts.over} | 🔴 {counts.under}
            </div>
          )}
        </div>
        <CardDescription className="text-xs">
          Book lines vs player averages — edges ≥15%
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Sport Tabs */}
        <SportTabs tabs={sportTabs} activeTab={sportFilter} onTabChange={setSportFilter} />

        {/* Signal + Confidence Filters */}
        <div className="flex gap-1.5 flex-wrap">
          {(["ALL", "OVER", "UNDER"] as const).map(s => (
            <QuickFilter
              key={s}
              label={s}
              active={signalFilter === s}
              onClick={() => setSignalFilter(s)}
              icon={s === "OVER" ? "🟢" : s === "UNDER" ? "🔴" : undefined}
              variant={s === "OVER" ? "success" : s === "UNDER" ? "danger" : "default"}
            />
          ))}
          <span className="w-px bg-border/50 mx-1" />
          {(["ALL", "ELITE", "HIGH", "MEDIUM"] as const).map(c => (
            <QuickFilter
              key={c}
              label={`${c}${c !== "ALL" ? ` (${counts[c.toLowerCase() as keyof typeof counts] || 0})` : ""}`}
              active={confidenceFilter === c}
              onClick={() => setConfidenceFilter(c)}
              variant={c === "ELITE" ? "warning" : c === "HIGH" ? "success" : "default"}
            />
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No mispriced lines found</p>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="mt-3">
              <RefreshCw className={cn("w-4 h-4 mr-2", isRefreshing && "animate-spin")} />
              Run Detection
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {filtered.slice(0, 50).map((line) => {
              const absEdge = Math.abs(line.edge_pct);
              const isOver = line.signal === "OVER";
              const sportIcon = line.sport === "baseball_mlb" ? "⚾" : "🏀";
              const avgLabel = line.sport === "baseball_mlb" ? "Season" : "L10";

              return (
                <div
                  key={line.id}
                  className={cn(
                    "p-2.5 rounded-lg border bg-background/50 hover:bg-background/80 transition-colors",
                    line.confidence_tier === "ELITE" && "border-yellow-500/30 bg-yellow-500/5",
                    line.confidence_tier === "HIGH" && "border-green-500/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs">{sportIcon}</span>
                        <span className="font-medium text-sm truncate">{line.player_name}</span>
                        <Badge variant="outline" className={cn("text-[10px]", CONFIDENCE_COLORS[line.confidence_tier] || CONFIDENCE_COLORS.LOW)}>
                          {line.confidence_tier}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span>{formatPropType(line.prop_type)}</span>
                        <span>•</span>
                        <span>Line: {line.book_line}</span>
                        <span>•</span>
                        <span>{avgLabel}: {line.player_avg_l10?.toFixed(1) ?? "—"}</span>
                      </div>
                      <ExpandableContext line={line} />
                    </div>
                    <div className="text-right shrink-0">
                      <div className={cn(
                        "text-sm font-bold font-mono",
                        isOver ? "text-green-400" : "text-red-400",
                        absEdge >= 50 && isOver && "text-green-300",
                        absEdge >= 50 && !isOver && "text-red-300",
                      )}>
                        {isOver ? "+" : ""}{line.edge_pct.toFixed(0)}%
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] mt-0.5",
                          isOver
                            ? "bg-green-500/10 text-green-400 border-green-500/30"
                            : "bg-red-500/10 text-red-400 border-red-500/30"
                        )}
                      >
                        {isOver ? "📈 OVER" : "📉 UNDER"}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length > 50 && (
              <p className="text-xs text-center text-muted-foreground pt-2">
                Showing 50 of {filtered.length} lines
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
