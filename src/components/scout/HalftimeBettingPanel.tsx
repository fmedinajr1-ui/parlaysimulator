import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PropEdge, HalftimeLockedProp, TeamLiveState, GameBetEdge, PlayerLiveState } from '@/types/scout-agent';
import { EdgeFilters, PropKind } from './EdgeFilters';
import { EdgeRowCompact } from './EdgeRowCompact';
import { GameBetEdgeCard } from './GameBetEdgeCard';
import { Lock, Target, Zap, Copy, RefreshCw, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

interface HalftimeBettingPanelProps {
  edges: PropEdge[];
  mode: 'LIVE' | 'HALFTIME_LOCK';
  lockedRecommendations: HalftimeLockedProp[];
  gameTime: string;
  lockTime?: string;
  // Game-level bets
  homeTeamState?: TeamLiveState | null;
  awayTeamState?: TeamLiveState | null;
  gameBetEdges?: GameBetEdge[];
  // Refresh stats
  onRefreshStats?: () => Promise<{ success: boolean; playerCount?: number; reason?: string }>;
  isRefreshing?: boolean;
  lastPbpUpdate?: Date | null;
  lastPbpGameTime?: string | null;
  // Player states for fatigue lookup
  playerStates?: Map<string, PlayerLiveState>;
}

// Composite ranking algorithm for "bet usefulness"
function rankEdge(e: PropEdge): number {
  const edge = Math.abs((e.expectedFinal ?? 0) - (e.line ?? 0));
  const conf = e.calibratedProb != null ? e.calibratedProb * 100 : e.confidence;
  const unc = e.uncertainty ?? 0;
  const volPenalty = e.rotationVolatilityFlag ? 12 : 0;
  
  // Higher is better: confidence + edge bonus - uncertainty penalty - volatility penalty
  return conf + (edge * 8) - (unc * 6) - volPenalty;
}

export function HalftimeBettingPanel({
  edges,
  mode,
  lockedRecommendations,
  gameTime,
  lockTime,
  homeTeamState,
  awayTeamState,
  gameBetEdges = [],
  onRefreshStats,
  isRefreshing = false,
  lastPbpUpdate,
  lastPbpGameTime,
  playerStates,
}: HalftimeBettingPanelProps) {
  const { toast } = useToast();
  
  // Filter state
  const [propFilter, setPropFilter] = useState<PropKind | 'ALL'>('ALL');
  const [hideVolatile, setHideVolatile] = useState(true);
  const [startersOnly, setStartersOnly] = useState(false);
  const [minConfidence, setMinConfidence] = useState(65);
  const [fatigueUndersOnly, setFatigueUndersOnly] = useState(false);

  // Helper to get player fatigue from playerStates
  const getPlayerFatigue = (playerName: string): number => {
    if (!playerStates) return 0;
    
    // Try exact match first
    const exactMatch = playerStates.get(playerName);
    if (exactMatch) return exactMatch.fatigueScore;
    
    // Try last name match
    const lastName = playerName.split(' ').pop()?.toLowerCase() || '';
    for (const [key, player] of playerStates.entries()) {
      if (key.toLowerCase().includes(lastName) || 
          player.playerName.toLowerCase().includes(lastName)) {
        return player.fatigueScore;
      }
    }
    return 0;
  };

  // Convert locked recommendations to PropEdge format for display
  const lockedEdges: PropEdge[] = useMemo(() => {
    return lockedRecommendations.map(rec => {
      // Calculate currentStat based on the prop type
      const stats = rec.firstHalfStats;
      const currentStat = rec.prop === 'Points' ? stats?.points :
                          rec.prop === 'Rebounds' ? stats?.rebounds :
                          rec.prop === 'Assists' ? stats?.assists :
                          rec.prop === 'PRA' ? ((stats?.points || 0) + (stats?.rebounds || 0) + (stats?.assists || 0)) :
                          stats?.points;
      
      return {
        player: rec.player,
        prop: rec.prop as PropEdge['prop'],
        line: rec.line,
        lean: rec.lean,
        confidence: rec.confidence,
        expectedFinal: rec.expectedFinal ?? rec.line + (rec.lean === 'OVER' ? 2 : -2),
        drivers: rec.drivers,
        riskFlags: [],
        trend: 'stable' as const,
        gameTime: lockTime || '',
        overPrice: rec.overPrice,
        underPrice: rec.underPrice,
        bookmaker: rec.bookmaker,
        currentStat,
        rotationRole: undefined,
      };
    });
  }, [lockedRecommendations, lockTime]);

  // Filter and rank active edges
  const rankedEdges = useMemo(() => {
    const getConfidence = (e: PropEdge) => 
      e.calibratedProb != null ? Math.round(e.calibratedProb * 100) : e.confidence;

    return [...(edges || [])]
      .filter(e => propFilter === 'ALL' || e.prop === propFilter)
      .filter(e => getConfidence(e) >= minConfidence)
      .filter(e => !hideVolatile || !e.rotationVolatilityFlag)
      .filter(e => {
        if (!startersOnly) return true;
        const role = e.rotationRole?.toUpperCase();
        return role === 'STARTER' || role === 'CLOSER';
      })
      // Fatigue filter - show only edges where player fatigue >= 60
      .filter(e => {
        if (!fatigueUndersOnly) return true;
        const fatigue = getPlayerFatigue(e.player);
        return fatigue >= 60;
      })
      .sort((a, b) => rankEdge(b) - rankEdge(a))
      .slice(0, 8);
  }, [edges, propFilter, hideVolatile, startersOnly, minConfidence, fatigueUndersOnly, playerStates]);

  const handleCopyAll = () => {
    const bets = (mode === 'HALFTIME_LOCK' ? lockedEdges : rankedEdges)
      .map(e => `${e.player} ${e.prop} ${e.lean} ${e.line}`)
      .join('\n');
    navigator.clipboard.writeText(bets);
    toast({
      title: "All bets copied",
      description: `${rankedEdges.length} bets copied to clipboard`,
    });
  };

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3 px-3 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <CardTitle className="text-base sm:text-lg">Betting Console</CardTitle>
            {/* Status Badge - inline on mobile */}
            <Badge 
              variant="outline" 
              className={cn(
                "gap-1 text-[10px] px-1.5 py-0.5",
                mode === 'HALFTIME_LOCK' 
                  ? "bg-chart-2/10 text-chart-2 border-chart-2/30" 
                  : "bg-primary/10 text-primary border-primary/30"
              )}
            >
              {mode === 'HALFTIME_LOCK' ? (
                <><Lock className="w-2.5 h-2.5" />LOCKED</>
              ) : (
                <><div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />LIVE</>
              )}
            </Badge>
            {gameTime && (
              <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0.5">
                {gameTime}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            {onRefreshStats && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={async () => {
                  const result = await onRefreshStats();
                  if (result.success) {
                    toast({ title: "Refreshed", description: `${result.playerCount || 0} players` });
                  }
                }}
                disabled={isRefreshing}
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
              </Button>
            )}
            {lastPbpUpdate && (
              <span className="text-muted-foreground text-[10px] hidden sm:flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {formatDistanceToNow(lastPbpUpdate, { addSuffix: true })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              className="h-7 gap-1 text-xs px-2"
            >
              <Copy className="w-3 h-3" />
              Copy
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Game-Level Bets Section */}
        {(homeTeamState || awayTeamState) && (
          <GameBetEdgeCard
            homeTeam={homeTeamState || null}
            awayTeam={awayTeamState || null}
            gameBetEdges={gameBetEdges}
            gameTime={gameTime}
          />
        )}
        {/* Locked Recommendations Section */}
        {mode === 'HALFTIME_LOCK' && lockedEdges.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-2 bg-chart-2/10 rounded-lg border border-chart-2/30">
              <Lock className="w-4 h-4 text-chart-2" />
              <div className="flex-1">
                <p className="font-medium text-sm">Halftime Bets Ready</p>
                <p className="text-xs text-muted-foreground">
                  Locked at {lockTime} • {lockedEdges.length} recommendations
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {lockedEdges.map((edge, idx) => (
                <EdgeRowCompact key={`locked-${edge.player}-${edge.prop}-${idx}`} edge={edge} rank={idx + 1} />
              ))}
            </div>

            {edges.length > 0 && (
              <div className="pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2">Live Tracking (Q3/Q4)</p>
              </div>
            )}
          </div>
        )}

        {/* Filters (for live mode or showing remaining edges after lock) */}
        {(mode === 'LIVE' || edges.length > 0) && (
          <EdgeFilters
            propFilter={propFilter}
            onPropFilterChange={setPropFilter}
            hideVolatile={hideVolatile}
            onHideVolatileChange={setHideVolatile}
            startersOnly={startersOnly}
            onStartersOnlyChange={setStartersOnly}
            minConfidence={minConfidence}
            onMinConfidenceChange={setMinConfidence}
            fatigueUndersOnly={fatigueUndersOnly}
            onFatigueUndersOnlyChange={setFatigueUndersOnly}
          />
        )}

        {/* Ranked Edges List */}
        {rankedEdges.length > 0 ? (
          <div className="space-y-2">
            {rankedEdges.map((edge, idx) => (
              <EdgeRowCompact 
                key={`${edge.player}-${edge.prop}-${idx}`} 
                edge={edge} 
                rank={mode === 'HALFTIME_LOCK' ? undefined : idx + 1}
              />
            ))}
          </div>
        ) : (
          mode === 'LIVE' && (
            <div className="text-center py-6 text-muted-foreground">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No edges match filters</p>
              <p className="text-xs">Lower confidence or allow volatile picks</p>
            </div>
          )
        )}

        {/* Pre-lock shimmer state */}
        {mode === 'LIVE' && edges.length === 0 && lockedRecommendations.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />
            ))}
            <p className="text-center text-xs text-muted-foreground mt-2">Scanning for edges...</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
