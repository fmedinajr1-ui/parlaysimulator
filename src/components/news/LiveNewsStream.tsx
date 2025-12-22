import { useState } from "react";
import { useGameNewsStream } from "@/hooks/useGameNewsStream";
import { SportTabs } from "@/components/ui/sport-tabs";
import { GameNewsCard } from "./GameNewsCard";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { FeedCard } from "@/components/FeedCard";
import { Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SPORT_TABS = [
  { id: 'all', label: 'All Sports' },
  { id: 'nfl', label: 'Football' },
  { id: 'nhl', label: 'Hockey' },
  { id: 'nba', label: 'Basketball' },
];

interface LiveNewsStreamProps {
  maxGames?: number;
  className?: string;
}

export function LiveNewsStream({ maxGames = 10, className }: LiveNewsStreamProps) {
  const [activeSport, setActiveSport] = useState('all');
  const { games, isLoading, isConnected, triggerRefresh } = useGameNewsStream(activeSport);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await triggerRefresh();
    setIsRefreshing(false);
  };

  const displayedGames = games.slice(0, maxGames);

  return (
    <section className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-neon-red animate-pulse" />
          <h2 className="font-display text-lg tracking-wide">Live Market & Game Updates</h2>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionIndicator isConnected={isConnected} />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Sport Filter */}
      <SportTabs
        tabs={SPORT_TABS}
        activeTab={activeSport}
        onTabChange={setActiveSport}
      />

      {/* Games List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <FeedCard key={i} variant="glass" className="animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 bg-muted rounded" />
                  <div className="h-3 w-1/3 bg-muted rounded" />
                </div>
              </div>
            </FeedCard>
          ))}
        </div>
      ) : displayedGames.length > 0 ? (
        <div className="space-y-3">
          {displayedGames.map((game) => (
            <GameNewsCard
              key={game.event_id}
              game={game}
              defaultExpanded={game.activity_score >= 8}
            />
          ))}
        </div>
      ) : (
        <FeedCard variant="glass" className="text-center py-8">
          <div className="text-3xl mb-2">📡</div>
          <p className="text-muted-foreground text-sm">
            No upcoming {activeSport === 'all' ? '' : SPORT_TABS.find(t => t.id === activeSport)?.label.toLowerCase() + ' '}games with updates
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Check back closer to game time
          </p>
        </FeedCard>
      )}
    </section>
  );
}
