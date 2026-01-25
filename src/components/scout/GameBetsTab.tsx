import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TeamLiveState, GameBetEdge } from '@/types/scout-agent';
import { GameBetEdgeCard } from './GameBetEdgeCard';
import { Target, TrendingUp, Activity, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GameBetsTabProps {
  homeTeamState: TeamLiveState | null;
  awayTeamState: TeamLiveState | null;
  gameBetEdges: GameBetEdge[];
  gameTime: string;
  vegasData?: {
    vegasTotal: number;
    vegasSpread: number;
    moneylineHome: number | null;
    moneylineAway: number | null;
    paceRating: string;
    gameScript: string;
  };
}

export function GameBetsTab({
  homeTeamState,
  awayTeamState,
  gameBetEdges,
  gameTime,
  vegasData,
}: GameBetsTabProps) {
  // Empty state when no team data
  if (!homeTeamState || !awayTeamState) {
    return (
      <Card className="border-dashed border-muted">
        <CardContent className="py-12 text-center">
          <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
          <h3 className="font-semibold mb-2">Analyzing Game...</h3>
          <p className="text-sm text-muted-foreground">
            Team-level projections (ML, Total, Spread) will appear once the agent has processed enough game data.
          </p>
          {gameTime && (
            <Badge variant="outline" className="mt-4 font-mono">
              {gameTime}
            </Badge>
          )}
        </CardContent>
      </Card>
    );
  }

  const highConfEdges = gameBetEdges.filter(e => e.confidence >= 65);

  return (
    <div className="space-y-4">
      {/* Game Bet Edge Card - Main Projections */}
      <GameBetEdgeCard
        homeTeam={homeTeamState}
        awayTeam={awayTeamState}
        gameBetEdges={gameBetEdges}
        gameTime={gameTime}
      />

      {/* Vegas Reference Panel */}
      {vegasData && (
        <Card className="border-muted bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Vegas Reference
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Total</span>
                <p className="font-semibold">{vegasData.vegasTotal}</p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Spread</span>
                <p className="font-semibold">
                  {vegasData.vegasSpread > 0 ? '+' : ''}{vegasData.vegasSpread}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Pace</span>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs",
                    vegasData.paceRating === 'HIGH' && "border-chart-2/50 text-chart-2",
                    vegasData.paceRating === 'LOW' && "border-blue-500/50 text-blue-400"
                  )}
                >
                  {vegasData.paceRating}
                </Badge>
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground text-xs">Script</span>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs",
                    vegasData.gameScript === 'SHOOTOUT' && "border-orange-500/50 text-orange-400",
                    vegasData.gameScript === 'GRIND_OUT' && "border-muted text-muted-foreground"
                  )}
                >
                  {vegasData.gameScript}
                </Badge>
              </div>
            </div>

            {/* Moneyline Odds if available */}
            {(vegasData.moneylineHome || vegasData.moneylineAway) && (
              <div className="mt-3 pt-3 border-t border-muted flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">ML:</span>
                {vegasData.moneylineHome && (
                  <span className="flex items-center gap-1">
                    {homeTeamState?.teamAbbrev}
                    <span className={cn(
                      "font-mono",
                      vegasData.moneylineHome > 0 ? "text-chart-2" : "text-foreground"
                    )}>
                      {vegasData.moneylineHome > 0 ? '+' : ''}{vegasData.moneylineHome}
                    </span>
                  </span>
                )}
                {vegasData.moneylineAway && (
                  <span className="flex items-center gap-1">
                    {awayTeamState?.teamAbbrev}
                    <span className={cn(
                      "font-mono",
                      vegasData.moneylineAway > 0 ? "text-chart-2" : "text-foreground"
                    )}>
                      {vegasData.moneylineAway > 0 ? '+' : ''}{vegasData.moneylineAway}
                    </span>
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* High Confidence Summary */}
      {highConfEdges.length > 0 && (
        <Card className="border-chart-4/30 bg-chart-4/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Flame className="w-4 h-4 text-chart-4" />
              High Confidence Edges ({highConfEdges.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {highConfEdges.map((edge, idx) => (
                <Badge 
                  key={`high-conf-${idx}`}
                  variant="secondary"
                  className="gap-1.5 text-sm"
                >
                  <span className="font-semibold">{edge.betType}</span>
                  <span className="text-muted-foreground">
                    {edge.lean} @ {edge.confidence}%
                  </span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No edges yet message */}
      {gameBetEdges.length === 0 && (
        <Card className="border-dashed border-muted">
          <CardContent className="py-6 text-center text-muted-foreground">
            <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              Waiting for more game data to generate predictions...
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
