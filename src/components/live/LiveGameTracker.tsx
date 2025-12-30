import React, { useState } from 'react';
import { useLiveScores, LiveGame } from '@/hooks/useLiveScores';
import { LiveScoreCard } from './LiveScoreCard';
import { PlayerStatProgress } from './PlayerStatProgress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Radio, Wifi, WifiOff, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

interface LiveGameTrackerProps {
  className?: string;
}

const SPORTS = ['ALL', 'NBA', 'NFL', 'NHL', 'MLB', 'NCAAB'];

export function LiveGameTracker({ className }: LiveGameTrackerProps) {
  const [selectedSport, setSelectedSport] = useState('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const { 
    games, 
    liveGames, 
    isLoading, 
    isConnected, 
    lastUpdated, 
    refresh, 
    triggerSync,
    getGameProgress 
  } = useLiveScores({
    sport: selectedSport === 'ALL' ? undefined : selectedSport,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await triggerSync();
    setIsRefreshing(false);
  };

  const filteredGames = selectedSport === 'ALL' 
    ? games 
    : games.filter(g => g.sport === selectedSport);

  const liveCount = filteredGames.filter(g => g.status === 'in_progress' || g.status === 'halftime').length;
  const scheduledGames = filteredGames.filter(g => g.status === 'scheduled');
  const inProgressGames = filteredGames.filter(g => g.status === 'in_progress' || g.status === 'halftime');
  const finalGames = filteredGames.filter(g => g.status === 'final');

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Radio className="w-5 h-5 text-destructive animate-pulse" />
            Live Games
          </h2>
          <Badge variant={liveCount > 0 ? 'destructive' : 'secondary'}>
            {liveCount} Live
          </Badge>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {isConnected ? (
              <Wifi className="w-3 h-3 text-chart-2" />
            ) : (
              <WifiOff className="w-3 h-3 text-destructive" />
            )}
            {lastUpdated && (
              <span>
                <Clock className="w-3 h-3 inline mr-1" />
                {formatDistanceToNow(lastUpdated, { addSuffix: true })}
              </span>
            )}
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('w-4 h-4 mr-1', isRefreshing && 'animate-spin')} />
            Sync
          </Button>
        </div>
      </div>

      {/* Sport Tabs */}
      <Tabs value={selectedSport} onValueChange={setSelectedSport}>
        <TabsList className="grid grid-cols-6 w-full">
          {SPORTS.map(sport => {
            const sportGames = sport === 'ALL' ? games : games.filter(g => g.sport === sport);
            const sportLive = sportGames.filter(g => g.status === 'in_progress' || g.status === 'halftime').length;
            
            return (
              <TabsTrigger key={sport} value={sport} className="relative text-xs">
                {sport}
                {sportLive > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full text-[10px] flex items-center justify-center">
                    {sportLive}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={selectedSport} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGames.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No games found</p>
                <p className="text-xs mt-1">Check back later for live scores</p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-6">
                {/* Live Games Section */}
                {inProgressGames.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
                      </span>
                      In Progress ({inProgressGames.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <AnimatePresence>
                        {inProgressGames.map((game, i) => (
                          <motion.div
                            key={game.eventId}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ delay: i * 0.05 }}
                          >
                            <LiveScoreCard 
                              game={game} 
                              onRefresh={handleRefresh}
                              showPlayerStats
                            />
                            
                            {/* Player Stats for Live Games */}
                            {game.playerStats.length > 0 && (
                              <div className="mt-2 space-y-2">
                                {game.playerStats
                                  .filter(p => p.points !== undefined && p.points > 10)
                                  .slice(0, 3)
                                  .map((player, j) => (
                                    <PlayerStatProgress
                                      key={player.playerId || j}
                                      playerName={player.playerName || 'Unknown'}
                                      currentValue={player.points || 0}
                                      line={25.5} // Example line - would come from props data
                                      statType="Points"
                                      gameProgress={getGameProgress(game)}
                                    />
                                  ))}
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )}

                {/* Scheduled Games Section */}
                {scheduledGames.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3">
                      Upcoming ({scheduledGames.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {scheduledGames.slice(0, 6).map((game, i) => (
                        <motion.div
                          key={game.eventId}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <LiveScoreCard game={game} showPlayerStats={false} />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final Games Section */}
                {finalGames.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3">
                      Final ({finalGames.length})
                    </h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      {finalGames.slice(0, 4).map((game, i) => (
                        <motion.div
                          key={game.eventId}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                        >
                          <LiveScoreCard game={game} showPlayerStats={false} />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}