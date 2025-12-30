import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LiveGame } from '@/hooks/useLiveScores';
import { Radio, RefreshCw, ChevronDown, ChevronUp, Trophy, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { motion, AnimatePresence } from 'framer-motion';

interface LiveScoreCardProps {
  game: LiveGame;
  onRefresh?: () => void;
  compact?: boolean;
  showPlayerStats?: boolean;
}

const SPORT_ICONS: Record<string, string> = {
  NBA: '🏀',
  NFL: '🏈',
  NHL: '🏒',
  MLB: '⚾',
  NCAAB: '🏀',
  NCAAF: '🏈',
};

export function LiveScoreCard({ game, onRefresh, compact = false, showPlayerStats = true }: LiveScoreCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [scoreFlash, setScoreFlash] = useState<'home' | 'away' | null>(null);
  const [prevScores, setPrevScores] = useState({ home: game.homeScore, away: game.awayScore });

  // Detect score changes for flash animation
  useEffect(() => {
    if (game.homeScore !== prevScores.home) {
      setScoreFlash('home');
      setTimeout(() => setScoreFlash(null), 1000);
    }
    if (game.awayScore !== prevScores.away) {
      setScoreFlash('away');
      setTimeout(() => setScoreFlash(null), 1000);
    }
    setPrevScores({ home: game.homeScore, away: game.awayScore });
  }, [game.homeScore, game.awayScore]);

  const isLive = game.status === 'in_progress' || game.status === 'halftime';
  const isFinal = game.status === 'final';
  const homeWinning = game.homeScore > game.awayScore;
  const awayWinning = game.awayScore > game.homeScore;

  const topPerformers = game.playerStats
    .filter((p) => p.points !== undefined)
    .sort((a, b) => (b.points || 0) - (a.points || 0))
    .slice(0, 2);

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-sm whitespace-nowrap">
        {isLive && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
          </span>
        )}
        <span className="text-muted-foreground">{SPORT_ICONS[game.sport]}</span>
        <span className={cn(awayWinning && 'font-semibold text-foreground')}>
          {game.awayTeam.split(' ').pop()} {game.awayScore}
        </span>
        <span className="text-muted-foreground">-</span>
        <span className={cn(homeWinning && 'font-semibold text-foreground')}>
          {game.homeScore} {game.homeTeam.split(' ').pop()}
        </span>
        {isLive && game.period && (
          <span className="text-muted-foreground text-xs">
            {game.period} {game.clock}
          </span>
        )}
        {isFinal && <span className="text-muted-foreground text-xs">FINAL</span>}
      </div>
    );
  }

  return (
    <Card className={cn(
      'overflow-hidden transition-all',
      isLive && 'ring-1 ring-destructive/30'
    )}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">{SPORT_ICONS[game.sport]}</span>
            <Badge variant={isLive ? 'destructive' : isFinal ? 'secondary' : 'outline'} className="text-xs">
              {isLive ? (
                <span className="flex items-center gap-1">
                  <Radio className="w-3 h-3 animate-pulse" />
                  LIVE
                </span>
              ) : isFinal ? (
                'FINAL'
              ) : (
                'SCHEDULED'
              )}
            </Badge>
            {isLive && game.period && (
              <span className="text-sm text-muted-foreground font-mono">
                {game.period} {game.clock}
              </span>
            )}
          </div>
          {onRefresh && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Score */}
        <div className="grid grid-cols-3 gap-4 items-center mb-3">
          {/* Away Team */}
          <div className="text-center">
            <p className={cn(
              'text-sm font-medium truncate',
              awayWinning && 'text-chart-2'
            )}>
              {game.awayTeam}
            </p>
            <motion.p
              key={game.awayScore}
              initial={{ scale: 1 }}
              animate={{ scale: scoreFlash === 'away' ? [1, 1.2, 1] : 1 }}
              className={cn(
                'text-3xl font-bold tabular-nums',
                awayWinning && 'text-chart-2',
                scoreFlash === 'away' && 'text-chart-2'
              )}
            >
              {game.awayScore}
            </motion.p>
          </div>

          {/* VS / @ */}
          <div className="text-center">
            <span className="text-muted-foreground text-lg">@</span>
          </div>

          {/* Home Team */}
          <div className="text-center">
            <p className={cn(
              'text-sm font-medium truncate',
              homeWinning && 'text-chart-2'
            )}>
              {game.homeTeam}
            </p>
            <motion.p
              key={game.homeScore}
              initial={{ scale: 1 }}
              animate={{ scale: scoreFlash === 'home' ? [1, 1.2, 1] : 1 }}
              className={cn(
                'text-3xl font-bold tabular-nums',
                homeWinning && 'text-chart-2',
                scoreFlash === 'home' && 'text-chart-2'
              )}
            >
              {game.homeScore}
            </motion.p>
          </div>
        </div>

        {/* Quarter Scores */}
        {Object.keys(game.quarterScores).length > 0 && (
          <div className="flex justify-center gap-1 text-xs text-muted-foreground mb-3">
            {Object.entries(game.quarterScores).map(([team, quarters]) => (
              <div key={team} className="flex gap-1">
                <span className="font-medium">{team}:</span>
                {(quarters as any[]).map((q, i) => (
                  <span key={i}>{q.score}</span>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Top Performers */}
        {showPlayerStats && isLive && topPerformers.length > 0 && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
                <span className="flex items-center gap-1">
                  <Trophy className="w-3 h-3" />
                  Top Performers
                </span>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 space-y-2"
                >
                  {topPerformers.map((player, i) => (
                    <div key={player.playerId || i} className="flex items-center justify-between bg-muted/50 rounded-lg p-2 text-xs">
                      <div>
                        <p className="font-medium">{player.playerName}</p>
                        <p className="text-muted-foreground">{player.team}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{player.points} PTS</p>
                        <p className="text-muted-foreground">
                          {player.rebounds} REB • {player.assists} AST
                        </p>
                      </div>
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Last Updated */}
        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mt-3">
          <Clock className="w-3 h-3" />
          Updated {formatDistanceToNow(game.lastUpdated, { addSuffix: true })}
        </div>
      </CardContent>
    </Card>
  );
}