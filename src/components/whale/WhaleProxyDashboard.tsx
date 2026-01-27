import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Anchor, TrendingUp, Eye, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWhaleProxy } from "@/hooks/useWhaleProxy";
import { WhaleFilters } from "./WhaleFilters";
import { WhalePickCard } from "./WhalePickCard";
import { WhaleFeedHealth } from "./WhaleFeedHealth";
import { WhaleDisclaimer } from "./WhaleDisclaimer";
import { formatTimeAgo } from "@/lib/whaleUtils";

export function WhaleProxyDashboard() {
  const {
    livePicks,
    watchlistPicks,
    isSimulating,
    toggleSimulation,
    selectedSport,
    setSelectedSport,
    confidenceFilter,
    setConfidenceFilter,
    timeWindow,
    setTimeWindow,
    feedHealth,
    lastUpdate,
    isRefreshing,
    triggerRefresh
  } = useWhaleProxy();

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Anchor className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">PP Whale Proxy</h1>
              <p className="text-xs text-muted-foreground">Sharp signal detector • No NFL</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="text-right text-xs text-muted-foreground">
              Last update: {formatTimeAgo(lastUpdate)}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={triggerRefresh}
              disabled={isRefreshing || isSimulating}
              className="h-8 w-8"
            >
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mb-4">
          <WhaleDisclaimer />
        </div>

        {/* Filters */}
        <div className="mb-6">
          <WhaleFilters
            selectedSport={selectedSport}
            onSportChange={setSelectedSport}
            confidenceFilter={confidenceFilter}
            onConfidenceChange={setConfidenceFilter}
            timeWindow={timeWindow}
            onTimeWindowChange={setTimeWindow}
            isSimulating={isSimulating}
            onToggleSimulation={toggleSimulation}
          />
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-4 mb-6 text-sm">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-muted-foreground">Live Picks:</span>
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
              {livePicks.length}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-400" />
            <span className="text-muted-foreground">Watchlist:</span>
            <Badge variant="outline" className="text-amber-400 border-amber-500/30">
              {watchlistPicks.length}
            </Badge>
          </div>
        </div>

        {/* Live Picks Section */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-foreground">Live Picks</h2>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
              A/B Grade
            </Badge>
          </div>
          
        {livePicks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border border-dashed border-border/50 rounded-xl space-y-3">
              <TrendingUp className="w-8 h-8 mx-auto opacity-50" />
              <div>
                <p className="font-medium text-foreground">No Sharp Signals Detected</p>
                <p className="text-xs mt-2 max-w-xs mx-auto">
                  The detector is monitoring for PrizePicks vs book line divergences, 
                  rapid line movements, and book-to-book disagreements.
                </p>
              </div>
              <div className="text-[10px] text-muted-foreground/70 pt-2 border-t border-border/30 mx-8">
                Signals appear when games are 1-4 hours from tip-off with detectable market movement.
                {!feedHealth.isLive && " • Pipeline awaiting fresh data"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {livePicks.map(pick => (
                <WhalePickCard key={pick.id} pick={pick} />
              ))}
            </div>
          )}
        </section>

        {/* Watchlist Section */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-foreground">Watchlist</h2>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
              C Grade • 55-64
            </Badge>
          </div>
          
          {watchlistPicks.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground border border-dashed border-border/50 rounded-xl">
              <Eye className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No watchlist items</p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchlistPicks.map(pick => (
                <WhalePickCard key={pick.id} pick={pick} />
              ))}
            </div>
          )}
        </section>

        {/* Feed Health Section */}
        <section>
          <WhaleFeedHealth feedHealth={feedHealth} lastUpdate={lastUpdate} />
        </section>
      </div>
    </div>
  );
}
