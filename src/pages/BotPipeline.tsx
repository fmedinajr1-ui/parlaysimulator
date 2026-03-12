import { useState } from "react";
import { DesktopLayout } from "@/components/layout/DesktopLayout";
import { CollapsibleSection } from "@/components/results/CollapsibleSection";
import { PipelinePickDetail } from "@/components/bot/PipelinePickDetail";
import { Badge } from "@/components/ui/badge";
import { useBotPipeline, UniquePick } from "@/hooks/useBotPipeline";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { ArrowLeft, Layers, Filter, Trophy, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

function clusterBadge(cluster?: string) {
  const colors: Record<string, string> = {
    SHOOTOUT: "bg-[hsl(var(--neon-green)/0.15)] text-[hsl(var(--neon-green))] border-[hsl(var(--neon-green)/0.3)]",
    GRIND: "bg-[hsl(var(--neon-red)/0.15)] text-[hsl(var(--neon-red))] border-[hsl(var(--neon-red)/0.3)]",
    BLOWOUT: "bg-[hsl(var(--neon-orange)/0.15)] text-[hsl(var(--neon-orange))] border-[hsl(var(--neon-orange)/0.3)]",
    BALANCED: "bg-[hsl(var(--neon-blue)/0.15)] text-[hsl(var(--neon-blue))] border-[hsl(var(--neon-blue)/0.3)]",
  };
  if (!cluster) return null;
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${colors[cluster] || "bg-muted text-muted-foreground border-border"}`}>
      {cluster}
    </span>
  );
}

function defenseBadge(def?: string) {
  if (!def) return null;
  const color = def === "tough"
    ? "bg-[hsl(var(--neon-red)/0.15)] text-[hsl(var(--neon-red))] border-[hsl(var(--neon-red)/0.3)]"
    : def === "soft"
    ? "bg-[hsl(var(--neon-green)/0.15)] text-[hsl(var(--neon-green))] border-[hsl(var(--neon-green)/0.3)]"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${color}`}>
      🛡 {def}
    </span>
  );
}

function PickRow({ pick, onClick }: { pick: UniquePick; onClick: () => void }) {
  const sideLabel = pick.side?.toUpperCase() === "OVER" ? "O" : "U";
  const isGrindOver = pick.side?.toUpperCase() === "OVER" && pick._gameContext?.envCluster === "GRIND" && pick._gameContext?.defenseStrength === "tough";
  const hasDecline = pick.l3_avg != null && pick.l10_avg != null && pick.l3_avg < pick.l10_avg * 0.85 && pick.side?.toUpperCase() === "OVER";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-muted/40 ${
        isGrindOver ? "border-[hsl(var(--neon-red)/0.4)] bg-[hsl(var(--neon-red)/0.05)]" : "border-border/40 bg-card/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">{pick.player_name}</span>
            <span className="text-xs text-muted-foreground">
              {sideLabel} {pick.line} {pick.prop_type}
            </span>
            {isGrindOver && <span className="text-[10px] text-[hsl(var(--neon-red))]">🚫 BLOCKED</span>}
            {hasDecline && <span className="text-[10px] text-[hsl(var(--neon-orange))]">📉</span>}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            {clusterBadge(pick._gameContext?.envCluster)}
            {defenseBadge(pick._gameContext?.defenseStrength)}
            {pick.team_name && (
              <span className="text-[10px] text-muted-foreground">{pick.team_name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {pick.composite_score != null && (
            <div className="text-center">
              <div className="text-sm font-bold text-[hsl(var(--neon-cyan))]">{pick.composite_score}</div>
              <div className="text-[9px] text-muted-foreground">SCORE</div>
            </div>
          )}
          {pick.l10_hit_rate != null && (
            <div className="text-center">
              <div className="text-sm font-bold text-[hsl(var(--neon-green))]">{Math.round(pick.l10_hit_rate * 100)}%</div>
              <div className="text-[9px] text-muted-foreground">L10</div>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function tierColor(tier: string): string {
  switch (tier) {
    case "execution": return "bg-[hsl(var(--neon-green)/0.15)] text-[hsl(var(--neon-green))] border-[hsl(var(--neon-green)/0.3)]";
    case "exploration": return "bg-[hsl(var(--neon-purple)/0.15)] text-[hsl(var(--neon-purple))] border-[hsl(var(--neon-purple)/0.3)]";
    case "validation": return "bg-[hsl(var(--neon-blue)/0.15)] text-[hsl(var(--neon-blue))] border-[hsl(var(--neon-blue)/0.3)]";
    case "bankroll_doubler": return "bg-[hsl(var(--neon-yellow)/0.15)] text-[hsl(var(--neon-yellow))] border-[hsl(var(--neon-yellow)/0.3)]";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export default function BotPipeline() {
  const navigate = useNavigate();
  const { parlays, uniquePicks, picksByGame, picksByCluster, parlaysByTier, today, isLoading } = useBotPipeline();
  const [selectedPick, setSelectedPick] = useState<UniquePick | null>(null);

  if (isLoading) return <WolfLoadingOverlay />;

  return (
    <DesktopLayout>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-display text-foreground">Bot Pipeline Explorer</h1>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            {today} <RefreshCw className="w-3 h-3 animate-spin opacity-40" /> Auto-refreshes every 60s
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {parlays.length} parlays · {uniquePicks.length} picks
        </Badge>
      </div>

      {parlays.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Layers className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm">No parlays generated yet today.</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Check back after the bot runs its daily pipeline.</p>
        </div>
      ) : (
        <div className="space-y-4 pb-20">
          {/* STEP 1: Initial Pool */}
          <CollapsibleSection
            title="Step 1 — Initial Pick Pool"
            icon={<Layers className="w-4 h-4 text-[hsl(var(--neon-cyan))]" />}
            defaultOpen={true}
            badge={<Badge variant="outline" className="text-[10px] ml-2">{uniquePicks.length} picks</Badge>}
          >
            {Array.from(picksByGame.entries()).map(([gameKey, picks]) => (
              <div key={gameKey} className="space-y-2">
                <p className="text-[11px] font-display uppercase tracking-wider text-muted-foreground px-1">
                  🏟️ {gameKey}
                </p>
                {picks.map((pick) => (
                  <PickRow key={pick.pickKey} pick={pick} onClick={() => setSelectedPick(pick)} />
                ))}
              </div>
            ))}
          </CollapsibleSection>

          {/* STEP 2: Filter View */}
          <CollapsibleSection
            title="Step 2 — Environment & Filter Tags"
            icon={<Filter className="w-4 h-4 text-[hsl(var(--neon-orange))]" />}
            badge={<Badge variant="outline" className="text-[10px] ml-2">{picksByCluster.size} clusters</Badge>}
          >
            {Array.from(picksByCluster.entries()).map(([cluster, picks]) => {
              const blocked = picks.filter(p => p.side?.toUpperCase() === "OVER" && p._gameContext?.envCluster === "GRIND" && p._gameContext?.defenseStrength === "tough");
              return (
                <div key={cluster} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    {clusterBadge(cluster)}
                    <span className="text-[11px] text-muted-foreground">{picks.length} picks</span>
                    {blocked.length > 0 && (
                      <span className="text-[10px] text-[hsl(var(--neon-red))]">🚫 {blocked.length} blocked</span>
                    )}
                  </div>
                  {picks.map((pick) => (
                    <PickRow key={pick.pickKey} pick={pick} onClick={() => setSelectedPick(pick)} />
                  ))}
                </div>
              );
            })}
          </CollapsibleSection>

          {/* STEP 3: Final Parlays */}
          <CollapsibleSection
            title="Step 3 — Final Parlays"
            icon={<Trophy className="w-4 h-4 text-[hsl(var(--neon-green))]" />}
            badge={<Badge variant="outline" className="text-[10px] ml-2">{parlays.length} parlays</Badge>}
            defaultOpen={true}
          >
            {Array.from(parlaysByTier.entries()).map(([tier, tierParlays]) => (
              <div key={tier} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold border uppercase ${tierColor(tier)}`}>
                    {tier}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{tierParlays.length} parlay(s)</span>
                </div>
                {tierParlays.map((parlay) => (
                  <div key={parlay.id} className="rounded-lg border border-border/50 bg-card/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{parlay.strategy_name}</span>
                        <Badge variant="outline" className="text-[10px]">{parlay.leg_count}L</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">
                          {parlay.expected_odds > 0 ? "+" : ""}{parlay.expected_odds}
                        </span>
                        <span className="text-xs text-[hsl(var(--neon-cyan))]">
                          {Math.round(parlay.combined_probability * 100)}%
                        </span>
                        {parlay.outcome && (
                          <Badge
                            className={`text-[10px] ${
                              parlay.outcome === "won"
                                ? "bg-[hsl(var(--neon-green)/0.2)] text-[hsl(var(--neon-green))]"
                                : parlay.outcome === "lost"
                                ? "bg-[hsl(var(--neon-red)/0.2)] text-[hsl(var(--neon-red))]"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {parlay.outcome}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      {((parlay.legs as unknown as UniquePick[]) || []).map((leg, i) => {
                        const key = `${leg.player_name}|${leg.prop_type}|${leg.line}|${leg.side}`;
                        const fullPick = uniquePicks.find(p => p.pickKey === key);
                        const sideLabel = leg.side?.toUpperCase() === "OVER" ? "O" : "U";
                        return (
                          <button
                            key={i}
                            onClick={() => fullPick && setSelectedPick(fullPick)}
                            className="w-full text-left flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted/30 transition-colors"
                          >
                            <span className="text-xs text-foreground">
                              {leg.player_name} <span className="text-muted-foreground">{sideLabel} {leg.line} {leg.prop_type}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              {clusterBadge(leg._gameContext?.envCluster)}
                              {leg.composite_score != null && (
                                <span className="text-[10px] text-[hsl(var(--neon-cyan))]">{leg.composite_score}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {parlay.selection_rationale && (
                      <p className="text-[10px] text-muted-foreground/70 pt-1 border-t border-border/30 leading-relaxed">
                        {parlay.selection_rationale}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </CollapsibleSection>
        </div>
      )}

      <PipelinePickDetail
        pick={selectedPick}
        open={!!selectedPick}
        onOpenChange={(open) => !open && setSelectedPick(null)}
      />
    </DesktopLayout>
  );
}
