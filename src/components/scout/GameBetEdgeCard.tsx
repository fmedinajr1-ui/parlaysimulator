import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GameBetEdge, TeamLiveState } from '@/types/scout-agent';
import { TrendingUp, TrendingDown, Target, Activity, Copy, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface GameBetEdgeCardProps {
  homeTeam: TeamLiveState | null;
  awayTeam: TeamLiveState | null;
  gameBetEdges: GameBetEdge[];
  gameTime?: string;
}

export function GameBetEdgeCard({
  homeTeam,
  awayTeam,
  gameBetEdges,
  gameTime,
}: GameBetEdgeCardProps) {
  const { toast } = useToast();

  const totalEdge = gameBetEdges.find(e => e.betType === 'TOTAL');
  const moneylineEdge = gameBetEdges.find(e => e.betType === 'MONEYLINE');
  const spreadEdge = gameBetEdges.find(e => e.betType === 'SPREAD');

  const handleCopy = (edge: GameBetEdge) => {
    let text = '';
    if (edge.betType === 'TOTAL') {
      text = `${edge.lean} ${edge.vegasLine} (Proj: ${edge.projectedTotal?.toFixed(1)})`;
    } else if (edge.betType === 'MONEYLINE') {
      text = `ML ${edge.lean} (${((edge.winProbability || 0) * 100).toFixed(0)}%)`;
    } else if (edge.betType === 'SPREAD') {
      text = `${edge.lean} ${edge.spreadLine} (Proj margin: ${edge.projectedMargin?.toFixed(1)})`;
    }
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: text });
  };

  if (!homeTeam || !awayTeam) {
    return null;
  }

  const scoreDiff = homeTeam.currentScore - awayTeam.currentScore;
  const totalScore = homeTeam.currentScore + awayTeam.currentScore;

  return (
    <Card className="border-chart-4/30 bg-card">
      <CardContent className="p-4 space-y-4">
        {/* Live Score Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-chart-4" />
            <div>
              <div className="font-semibold text-base">
                {awayTeam.teamAbbrev} {awayTeam.currentScore} @ {homeTeam.teamAbbrev} {homeTeam.currentScore}
              </div>
              <div className="text-xs text-muted-foreground">
                {gameTime} • Total: {totalScore}
              </div>
            </div>
          </div>
          
          {/* Team Fatigue Comparison */}
          <div className="flex gap-2 text-xs">
            <Badge variant="outline" className={cn(
              "gap-1",
              awayTeam.avgTeamFatigue > 55 ? "border-red-500/50 text-red-400" : "border-muted"
            )}>
              {awayTeam.teamAbbrev}: {Math.round(awayTeam.avgTeamFatigue)}F
            </Badge>
            <Badge variant="outline" className={cn(
              "gap-1",
              homeTeam.avgTeamFatigue > 55 ? "border-red-500/50 text-red-400" : "border-muted"
            )}>
              {homeTeam.teamAbbrev}: {Math.round(homeTeam.avgTeamFatigue)}F
            </Badge>
          </div>
        </div>

        {/* Run-In-Progress Indicators */}
        {(homeTeam.runInProgress || awayTeam.runInProgress) && (
          <div className="flex gap-2">
            {awayTeam.runInProgress && awayTeam.runPoints > 0 && (
              <Badge variant="outline" className="border-purple-500/70 text-purple-400 bg-purple-500/10 animate-pulse gap-1">
                <TrendingUp className="w-3 h-3" />
                {awayTeam.teamAbbrev} on {awayTeam.runPoints}-0 run
              </Badge>
            )}
            {homeTeam.runInProgress && homeTeam.runPoints > 0 && (
              <Badge variant="outline" className="border-blue-500/70 text-blue-400 bg-blue-500/10 animate-pulse gap-1">
                <TrendingUp className="w-3 h-3" />
                {homeTeam.teamAbbrev} on {homeTeam.runPoints}-0 run
              </Badge>
            )}
          </div>
        )}

        {/* Hot Player Badges */}
        {((homeTeam.hotPlayers?.length || 0) > 0 || (awayTeam.hotPlayers?.length || 0) > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {(awayTeam.hotPlayers || []).slice(0, 2).map((player, idx) => (
              <Badge key={`away-hot-${idx}`} variant="secondary" className="text-[10px] bg-orange-500/20 text-orange-300 gap-1">
                🔥 {player}
              </Badge>
            ))}
            {(homeTeam.hotPlayers || []).slice(0, 2).map((player, idx) => (
              <Badge key={`home-hot-${idx}`} variant="secondary" className="text-[10px] bg-orange-500/20 text-orange-300 gap-1">
                🔥 {player}
              </Badge>
            ))}
          </div>
        )}

        {/* Game Bet Edges */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          
          {/* Game Total Edge */}
          <div className={cn(
            "p-3 rounded-lg border",
            totalEdge && totalEdge.confidence >= 65 
              ? totalEdge.lean === 'OVER' 
                ? "bg-green-500/10 border-green-500/30" 
                : "bg-red-500/10 border-red-500/30"
              : "bg-muted/30 border-muted"
          )}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">TOTAL</span>
              {totalEdge && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-5 w-5 p-0"
                  onClick={() => handleCopy(totalEdge)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              )}
            </div>
            
            {totalEdge ? (
              <>
                <div className="flex items-center gap-2">
                  {totalEdge.lean === 'OVER' ? (
                    <TrendingUp className="w-4 h-4 text-green-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-red-500" />
                  )}
                  <span className={cn(
                    "font-bold",
                    totalEdge.lean === 'OVER' ? "text-green-500" : "text-red-500"
                  )}>
                    {totalEdge.lean} {totalEdge.vegasLine}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Proj: {totalEdge.projectedTotal?.toFixed(1)} 
                  <span className={cn(
                    "ml-1",
                    (totalEdge.edgeAmount || 0) > 0 ? "text-green-400" : "text-red-400"
                  )}>
                    ({(totalEdge.edgeAmount || 0) > 0 ? '+' : ''}{totalEdge.edgeAmount?.toFixed(1)})
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="h-1 flex-1 bg-muted rounded overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded",
                        totalEdge.lean === 'OVER' ? "bg-green-500" : "bg-red-500"
                      )}
                      style={{ width: `${totalEdge.confidence}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8">{totalEdge.confidence}%</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Analyzing...</div>
            )}
          </div>

          {/* Moneyline Edge */}
          <div className={cn(
            "p-3 rounded-lg border",
            moneylineEdge && moneylineEdge.confidence >= 65
              ? moneylineEdge.lean === 'HOME' 
                ? "bg-blue-500/10 border-blue-500/30"
                : "bg-purple-500/10 border-purple-500/30"
              : "bg-muted/30 border-muted"
          )}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">MONEYLINE</span>
              {moneylineEdge && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-5 w-5 p-0"
                  onClick={() => handleCopy(moneylineEdge)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              )}
            </div>
            
            {moneylineEdge ? (
              <>
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-chart-4" />
                  <span className="font-bold">
                    {moneylineEdge.lean === 'HOME' ? homeTeam.teamAbbrev : awayTeam.teamAbbrev}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Win Prob: {((moneylineEdge.winProbability || 0) * 100).toFixed(0)}%
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="h-1 flex-1 bg-muted rounded overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded",
                        moneylineEdge.lean === 'HOME' ? "bg-blue-500" : "bg-purple-500"
                      )}
                      style={{ width: `${moneylineEdge.confidence}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8">{moneylineEdge.confidence}%</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Analyzing...</div>
            )}
          </div>

          {/* Spread Edge */}
          <div className={cn(
            "p-3 rounded-lg border",
            spreadEdge && spreadEdge.confidence >= 65
              ? "bg-orange-500/10 border-orange-500/30"
              : "bg-muted/30 border-muted"
          )}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">SPREAD</span>
              {spreadEdge && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-5 w-5 p-0"
                  onClick={() => handleCopy(spreadEdge)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              )}
            </div>
            
            {spreadEdge ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-bold">
                    {spreadEdge.lean === 'HOME' ? homeTeam.teamAbbrev : awayTeam.teamAbbrev} {spreadEdge.spreadLine}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Proj margin: {spreadEdge.projectedMargin?.toFixed(1)}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <div className="h-1 flex-1 bg-muted rounded overflow-hidden">
                    <div 
                      className="h-full rounded bg-orange-500"
                      style={{ width: `${spreadEdge.confidence}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground w-8">{spreadEdge.confidence}%</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">Analyzing...</div>
            )}
          </div>
        </div>

        {/* Drivers Summary */}
        {gameBetEdges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {gameBetEdges.slice(0, 1).flatMap(e => e.drivers.slice(0, 3)).map((driver, idx) => (
              <Badge key={idx} variant="secondary" className="text-[10px]">
                {driver}
              </Badge>
            ))}
            {gameBetEdges.some(e => e.riskFlags.length > 0) && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                {gameBetEdges.flatMap(e => e.riskFlags)[0]}
              </Badge>
            )}
          </div>
        )}

        {/* Momentum Indicator */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Momentum:</span>
          <div className="flex-1 h-2 bg-muted rounded relative">
            <div 
              className={cn(
                "absolute top-0 h-full rounded",
                (homeTeam.momentumScore || 0) > 0 
                  ? "bg-blue-500 right-1/2" 
                  : "bg-purple-500 left-1/2"
              )}
              style={{ 
                width: `${Math.min(50, Math.abs(homeTeam.momentumScore || 0) / 2)}%` 
              }}
            />
            <div className="absolute top-0 left-1/2 w-0.5 h-full bg-foreground/30" />
          </div>
          <span className="text-[10px] w-16 text-right">
            {(homeTeam.momentumScore || 0) > 10 ? `${homeTeam.teamAbbrev} +${homeTeam.momentumScore}` :
             (homeTeam.momentumScore || 0) < -10 ? `${awayTeam.teamAbbrev} +${Math.abs(homeTeam.momentumScore || 0)}` :
             'Even'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
