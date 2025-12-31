import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RefreshCw, Wifi, WifiOff, Radio, Clock, Zap, TrendingUp } from 'lucide-react';
import { useParlayLiveProgress } from '@/hooks/useParlayLiveProgress';
import { LiveParlayCard } from './LiveParlayCard';
import { LivePlayerPropCard } from './LivePlayerPropCard';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export function LiveBettingDashboard() {
  const {
    parlayProgress,
    liveParlays,
    upcomingParlays,
    liveGames,
    isLoading,
    isConnected,
    lastUpdated,
    triggerSync,
  } = useParlayLiveProgress();

  const allLiveLegs = liveParlays.flatMap(p => 
    p.legs.filter(l => l.gameStatus === 'in_progress')
  );

  // Helper to create a stable game key from various sources
  const getGameKey = (leg: typeof allLiveLegs[0]): string => {
    if (leg.eventId) return leg.eventId;
    if (leg.gameInfo) return `${leg.gameInfo.awayTeam}@${leg.gameInfo.homeTeam}`;
    if (leg.matchup) return leg.matchup.replace(/\s+/g, '').toLowerCase();
    
    // Extract from description as last resort
    const desc = (leg.description || '').toLowerCase();
    const teamMatch = desc.match(/([a-z\s]+)\s*[@vs\.]+\s*([a-z\s]+)/i);
    if (teamMatch) return `${teamMatch[1].trim()}@${teamMatch[2].trim()}`;
    
    return 'unknown';
  };

  // Group legs by game AND deduplicate within each game
  const legsByGame = allLiveLegs.reduce((acc, leg) => {
    const key = getGameKey(leg);
    if (!acc[key]) {
      acc[key] = { gameInfo: leg.gameInfo, legs: [], seenBets: new Set<string>() };
    }
    
    // Create unique key for this specific bet (to avoid duplicates)
    const betKey = `${leg.description}-${leg.betType}-${leg.side}-${leg.line}`;
    
    if (!acc[key].seenBets.has(betKey)) {
      acc[key].seenBets.add(betKey);
      acc[key].legs.push(leg);
    }
    
    return acc;
  }, {} as Record<string, { gameInfo: any; legs: typeof allLiveLegs; seenBets: Set<string> }>);

  const handleSync = async () => {
    await triggerSync();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Status Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <div className="relative">
                  <Wifi className="w-4 h-4 text-chart-2" />
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-chart-2 animate-pulse" />
                </div>
                <span className="text-sm text-chart-2 font-medium">LIVE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Offline</span>
              </>
            )}
          </div>
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </span>
          )}
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleSync}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Sync
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Radio className="w-4 h-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold">{liveParlays.length}</div>
            <div className="text-xs text-muted-foreground">Live Parlays</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Zap className="w-4 h-4 text-chart-4" />
            </div>
            <div className="text-2xl font-bold">{liveGames.length}</div>
            <div className="text-xs text-muted-foreground">Live Games</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-4 h-4 text-chart-2" />
            </div>
            <div className="text-2xl font-bold">
              {liveParlays.reduce((acc, p) => acc + p.legsHitting, 0)}/
              {liveParlays.reduce((acc, p) => acc + p.legsTotal, 0)}
            </div>
            <div className="text-xs text-muted-foreground">Legs Hitting</div>
          </CardContent>
        </Card>
      </div>

      {/* Live Parlays Section */}
      {liveParlays.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-medium uppercase tracking-wide">Live Parlays</h2>
          </div>
          <AnimatePresence mode="popLayout">
            {liveParlays.map(parlay => (
              <motion.div
                key={parlay.parlayId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <LiveParlayCard parlay={parlay} defaultExpanded />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Live Games with Props */}
      {Object.entries(legsByGame).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Games with Your Props
          </h2>
          {Object.entries(legsByGame).map(([gameId, { gameInfo, legs }]) => (
            <Card key={gameId} className="bg-card/50 border-border/50">
              {gameInfo && (
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium">
                      {gameInfo.awayTeam} @ {gameInfo.homeTeam}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {gameInfo.period} • {gameInfo.clock}
                      </Badge>
                      <span className="font-bold tabular-nums">
                        {gameInfo.awayScore} - {gameInfo.homeScore}
                      </span>
                    </div>
                  </div>
                </CardHeader>
              )}
              <CardContent className="space-y-2">
                {legs.map((leg, i) => (
                  <LivePlayerPropCard key={i} leg={leg} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upcoming Parlays */}
      {upcomingParlays.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Upcoming
            </h2>
          </div>
          {upcomingParlays.map(parlay => (
            <LiveParlayCard key={parlay.parlayId} parlay={parlay} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {parlayProgress.length === 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="py-12 text-center">
            <Radio className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">No Pending Parlays</h3>
            <p className="text-sm text-muted-foreground">
              Your AI suggested parlays with live games will appear here
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
