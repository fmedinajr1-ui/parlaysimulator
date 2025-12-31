import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RefreshCw, Wifi, WifiOff, Radio, Clock, Zap, TrendingUp } from 'lucide-react';
import { useParlayLiveProgress, LegLiveProgress } from '@/hooks/useParlayLiveProgress';
import { LiveParlayCard } from './LiveParlayCard';
import { LivePlayerPropCard } from './LivePlayerPropCard';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

// Parse structured data from legacy description formats
const parseLegDescription = (desc: string) => {
  const cleanDesc = desc.replace(/[✅❌🔥⚡🌅🏥⭐🎯💰🔒📈📉🔄🎲🏀🏈⚾🏒]/g, '').trim();
  
  // Player prop patterns
  const propPatterns = [
    /^(.+?)\s+(points|assists|rebounds|threes|blocks|steals|pts\+reb\+ast|points_rebounds_assists|player_points|player_assists|player_rebounds)\s*(O|U|Over|Under)?\s*(\d+\.?\d*)/i,
    /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+Player\s+(Points|Assists|Rebounds)/i,
  ];
  
  for (const pattern of propPatterns) {
    const match = cleanDesc.match(pattern);
    if (match) {
      const isAltPattern = pattern.toString().includes('Player');
      return {
        playerName: match[1]?.trim(),
        propType: isAltPattern ? match[4]?.toLowerCase() : match[2]?.toLowerCase(),
        side: (isAltPattern ? match[2] : match[3])?.toLowerCase()?.startsWith('o') ? 'over' : 'under',
        line: parseFloat(isAltPattern ? match[3] : match[4]),
        awayTeam: null,
        homeTeam: null,
        isPlayerProp: true,
      };
    }
  }
  
  // Moneyline pattern: "Team Name ML vs Other Team"
  const mlMatch = cleanDesc.match(/^(.+?)\s*(ML|moneyline)\s*(vs\.?|@)?\s*(.+)?/i);
  if (mlMatch) {
    return {
      playerName: null,
      propType: 'moneyline',
      side: null,
      line: null,
      awayTeam: mlMatch[1]?.trim(),
      homeTeam: mlMatch[4]?.trim() || null,
      isPlayerProp: false,
    };
  }
  
  // Total pattern: "Over 238.5" or "Under 215.5"
  const totalMatch = cleanDesc.match(/(Over|Under)\s*(\d+\.?\d*)/i);
  if (totalMatch) {
    return {
      playerName: null,
      propType: 'total',
      side: totalMatch[1].toLowerCase(),
      line: parseFloat(totalMatch[2]),
      awayTeam: null,
      homeTeam: null,
      isPlayerProp: false,
    };
  }
  
  return { playerName: null, propType: null, side: null, line: null, awayTeam: null, homeTeam: null, isPlayerProp: false };
};

// Create a GLOBAL unique bet identifier for deduplication across ALL parlays
const getUniqueBetId = (leg: LegLiveProgress): string => {
  const cleanDesc = (leg.description || '')
    .replace(/[✅❌🔥⚡🌅🏥⭐🎯💰🔒📈📉🔄🎲🏀🏈⚾🏒]/g, '')
    .trim()
    .toLowerCase();
  
  const parsed = parseLegDescription(leg.description || '');
  const betTypeLower = (leg.betType || parsed.propType || '').toLowerCase();
  
  // For moneylines: use cleaned description as key
  if (betTypeLower.includes('moneyline') || betTypeLower.includes('ml') || cleanDesc.includes(' ml ')) {
    return `ml|${cleanDesc.replace(/\s+/g, '')}`;
  }
  
  // For totals: use side + line
  if (betTypeLower.includes('total') || parsed.propType === 'total') {
    const side = leg.side || parsed.side || 'over';
    const lineVal = leg.line ?? parsed.line ?? 0;
    return `total|${side}|${lineVal}`;
  }
  
  // For player props: use player + propType + side + line
  const player = (leg.playerName || parsed.playerName || '').toLowerCase().replace(/\s+/g, '');
  const type = leg.betType || parsed.propType || '';
  const side = leg.side || parsed.side || '';
  const lineVal = leg.line ?? parsed.line ?? 0;
  
  if (player) {
    return `prop|${player}|${type}|${side}|${lineVal}`;
  }
  
  // Fallback: use cleaned description hash
  return `other|${cleanDesc.replace(/\s+/g, '')}`;
};

// Helper to create a stable game key from various sources
const getGameKey = (leg: LegLiveProgress): string => {
  if (leg.eventId) return leg.eventId;
  if (leg.gameInfo) return `${leg.gameInfo.awayTeam}@${leg.gameInfo.homeTeam}`.toLowerCase();
  if (leg.matchup) return leg.matchup.replace(/\s+/g, '').toLowerCase();
  
  // Parse from description as fallback
  const parsed = parseLegDescription(leg.description || '');
  if (parsed.awayTeam && parsed.homeTeam) {
    return `${parsed.awayTeam}@${parsed.homeTeam}`.toLowerCase();
  }
  
  // Last resort: normalized description prefix
  return (leg.description || 'unknown').substring(0, 30).toLowerCase().replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
};

export function LiveBettingDashboard() {
  const [isSyncing, setIsSyncing] = useState(false);
  
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

  // Get all live legs and GLOBALLY deduplicate with parlay count tracking
  const { allLiveLegs, legsByGame } = (() => {
    const allLegsRaw = liveParlays.flatMap(p => 
      p.legs.filter(l => l.gameStatus === 'in_progress').map(l => ({ ...l, parlayId: p.parlayId }))
    );
    
    // Track which parlays contain each unique bet
    const betToParlays = new Map<string, Set<string>>();
    allLegsRaw.forEach(leg => {
      const betId = getUniqueBetId(leg);
      if (!betToParlays.has(betId)) {
        betToParlays.set(betId, new Set());
      }
      betToParlays.get(betId)!.add((leg as any).parlayId);
    });
    
    // Deduplicate and attach parlay count
    const seenBetIds = new Set<string>();
    const uniqueLegs = allLegsRaw.filter(leg => {
      const betId = getUniqueBetId(leg);
      if (seenBetIds.has(betId)) return false;
      seenBetIds.add(betId);
      return true;
    }).map(leg => ({
      ...leg,
      parlayCount: betToParlays.get(getUniqueBetId(leg))?.size || 1,
    }));

    // Group deduplicated legs by game
    const byGame = uniqueLegs.reduce((acc, leg) => {
      const key = getGameKey(leg);
      if (!acc[key]) {
        acc[key] = { gameInfo: leg.gameInfo, legs: [] };
      }
      acc[key].legs.push(leg);
      return acc;
    }, {} as Record<string, { gameInfo: any; legs: typeof uniqueLegs }>);
    
    return { allLiveLegs: uniqueLegs, legsByGame: byGame };
  })();

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await triggerSync();
    } finally {
      setIsSyncing(false);
    }
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
          variant="outline" 
          size="sm" 
          onClick={handleSync}
          disabled={isSyncing}
          className="gap-2"
        >
          <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
          {isSyncing ? 'Refreshing...' : 'Refresh'}
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
