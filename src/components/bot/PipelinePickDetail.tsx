// @ts-nocheck
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import type { UniquePick } from "@/hooks/useBotPipeline";

interface PipelinePickDetailProps {
  pick: UniquePick | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function StatRow({ label, value, color }: { label: string; value: string | number | undefined | null; color?: string }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${color || "text-foreground"}`}>{value}</span>
    </div>
  );
}

function clusterColor(cluster?: string): string {
  switch (cluster) {
    case "SHOOTOUT": return "text-[hsl(var(--neon-green))]";
    case "GRIND": return "text-[hsl(var(--neon-red))]";
    case "BLOWOUT": return "text-[hsl(var(--neon-orange))]";
    default: return "text-[hsl(var(--neon-blue))]";
  }
}

function defenseColor(def?: string): string {
  switch (def) {
    case "tough": return "text-[hsl(var(--neon-red))]";
    case "soft": return "text-[hsl(var(--neon-green))]";
    default: return "text-muted-foreground";
  }
}

export function PipelinePickDetail({ pick, open, onOpenChange }: PipelinePickDetailProps) {
  if (!pick) return null;

  const gc = pick._gameContext;
  const sideLabel = pick.side?.toUpperCase() === "OVER" ? "O" : "U";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-background border-border overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="text-foreground font-display text-lg">
            {pick.player_name}
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {sideLabel} {pick.line} {pick.prop_type}
            {pick.american_odds != null && (
              <span className="ml-2 text-[hsl(var(--neon-cyan))]">
                @ {pick.american_odds > 0 ? "+" : ""}{pick.american_odds}
              </span>
            )}
          </p>
        </SheetHeader>

        {/* Stats */}
        <div className="space-y-1 mb-5">
          <h4 className="text-xs font-display uppercase tracking-wider text-muted-foreground mb-2">📊 Performance</h4>
          <div className="rounded-lg border border-border/50 bg-card/50 p-3">
            <StatRow label="L10 Hit Rate" value={pick.l10_hit_rate != null ? `${Math.round(pick.l10_hit_rate * 100)}%` : undefined} color="text-[hsl(var(--neon-green))]" />
            <StatRow label="Overall Hit Rate" value={pick.hit_rate != null ? `${Math.round(pick.hit_rate * 100)}%` : undefined} />
            <StatRow label="Composite Score" value={pick.composite_score} color="text-[hsl(var(--neon-cyan))]" />
            <StatRow label="Confidence" value={pick.confidence_score != null ? `${Math.round(pick.confidence_score * 100)}%` : undefined} />
            <StatRow label="Category" value={pick.category} />
            <StatRow label="L3 Avg" value={pick.l3_avg != null ? pick.l3_avg.toFixed(1) : undefined} />
            <StatRow label="L10 Avg" value={pick.l10_avg != null ? pick.l10_avg.toFixed(1) : undefined} />
            <StatRow label="Season Avg" value={pick.season_avg != null ? pick.season_avg.toFixed(1) : undefined} />
          </div>
        </div>

        {/* Game Context */}
        {gc && (
          <div className="space-y-1 mb-5">
            <h4 className="text-xs font-display uppercase tracking-wider text-muted-foreground mb-2">🏀 Game Context</h4>
            <div className="rounded-lg border border-border/50 bg-card/50 p-3">
              <StatRow
                label="Env Cluster"
                value={gc.envCluster ? `${gc.envCluster} (${gc.envClusterStrength || "?"})` : undefined}
                color={clusterColor(gc.envCluster)}
              />
              <StatRow label="Defense" value={gc.defenseStrength} color={defenseColor(gc.defenseStrength)} />
              {gc.defenseRank != null && <StatRow label="Defense Rank" value={`#${gc.defenseRank}`} />}
              <StatRow label="Pace" value={gc.pace} />
              <StatRow label="Vegas Total" value={gc.vegasTotal} />
              <StatRow
                label="Team Total Signal"
                value={gc.teamTotalSignal ? `${gc.teamTotalSignal} (${gc.teamTotalComposite || "?"})` : undefined}
              />
              <StatRow label="Blowout Risk" value={gc.blowoutRisk ? "⚠️ Yes" : "No"} color={gc.blowoutRisk ? "text-[hsl(var(--neon-orange))]" : undefined} />
              <StatRow label="Opponent" value={gc.opponentAbbrev} />
              <StatRow label="Game" value={gc.gameKey} />
            </div>
          </div>
        )}

        {/* Warnings */}
        {pick.side?.toUpperCase() === "OVER" && gc?.envCluster === "GRIND" && gc?.defenseStrength === "tough" && (
          <div className="mb-5 p-3 rounded-lg border border-[hsl(var(--neon-red)/0.5)] bg-[hsl(var(--neon-red)/0.1)]">
            <p className="text-xs font-medium text-[hsl(var(--neon-red))]">
              ⚠️ GRIND + Tough Defense — OVER picks in this environment are hard-blocked by the pipeline filter.
            </p>
          </div>
        )}

        {pick.l3_avg != null && pick.l10_avg != null && pick.l3_avg < pick.l10_avg * 0.85 && pick.side?.toUpperCase() === "OVER" && (
          <div className="mb-5 p-3 rounded-lg border border-[hsl(var(--neon-orange)/0.5)] bg-[hsl(var(--neon-orange)/0.1)]">
            <p className="text-xs font-medium text-[hsl(var(--neon-orange))]">
              📉 Recency Decline — L3 avg ({pick.l3_avg.toFixed(1)}) is {Math.round((1 - pick.l3_avg / pick.l10_avg) * 100)}% below L10 avg ({pick.l10_avg.toFixed(1)})
            </p>
          </div>
        )}

        {/* Selection Info */}
        <div className="space-y-1 mb-5">
          <h4 className="text-xs font-display uppercase tracking-wider text-muted-foreground mb-2">📋 Selection Info</h4>
          <div className="rounded-lg border border-border/50 bg-card/50 p-3">
            <div className="mb-2">
              <span className="text-xs text-muted-foreground">Appears in {pick.parlayIds.length} parlay(s):</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {pick.strategyNames.map((s) => (
                <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
              ))}
            </div>
            {pick.rationaleSnippets.length > 0 && (
              <div className="space-y-2">
                {pick.rationaleSnippets.map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground leading-relaxed">{r}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
