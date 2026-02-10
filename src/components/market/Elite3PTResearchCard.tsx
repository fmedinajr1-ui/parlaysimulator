import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getEasternDate } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { use3PTMatchupAnalysis } from '@/hooks/use3PTMatchupAnalysis';
import { useRecordParlayOutcome, ParlayLeg } from '@/hooks/useRecordParlayOutcome';
import { Search, Target, TrendingUp, Trophy, Plus } from 'lucide-react';

export function Elite3PTResearchCard() {
  const [searchPlayer, setSearchPlayer] = useState('');
  const { 
    eliteMatchups, 
    goodMatchups, 
    buildPlayerProfile, 
    isLoading 
  } = use3PTMatchupAnalysis();
  
  const { 
    outcomes, 
    recordOutcome, 
    analyzePatterns, 
    getWinningPlayers,
    isRecording 
  } = useRecordParlayOutcome();

  const patterns = analyzePatterns();
  const winningPlayers = getWinningPlayers();
  const playerProfile = searchPlayer ? buildPlayerProfile(searchPlayer) : null;

  // Quick record a winning parlay
  const [quickLegs, setQuickLegs] = useState<ParlayLeg[]>([]);
  const [newLeg, setNewLeg] = useState({ player: '', line: 1.5 });

  const addLeg = () => {
    if (newLeg.player) {
      setQuickLegs([...quickLegs, { 
        player: newLeg.player, 
        line: newLeg.line, 
        prop_type: 'player_threes',
        outcome: 'hit'
      }]);
      setNewLeg({ player: '', line: 1.5 });
    }
  };

  const recordWin = () => {
    if (quickLegs.length > 0) {
      recordOutcome({
        parlay_date: getEasternDate(),
        total_legs: quickLegs.length,
        legs: quickLegs,
        outcome: 'won',
        source: 'prizepicks',
      });
      setQuickLegs([]);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5 text-primary" />
          3PT Research Dashboard
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="matchups" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="matchups">H2H Matchups</TabsTrigger>
            <TabsTrigger value="patterns">Win Patterns</TabsTrigger>
            <TabsTrigger value="record">Record Win</TabsTrigger>
          </TabsList>

          {/* H2H Matchups Tab */}
          <TabsContent value="matchups" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search player..."
                value={searchPlayer}
                onChange={(e) => setSearchPlayer(e.target.value)}
                className="flex-1"
              />
              <Button size="icon" variant="outline">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {playerProfile && (
              <div className="p-3 rounded-lg bg-muted/30 space-y-2">
                <h4 className="font-semibold">{playerProfile.player_name}</h4>
                {playerProfile.best_opponent && (
                  <p className="text-sm text-muted-foreground">
                    Best vs: <span className="text-chart-2">{playerProfile.best_opponent.team}</span> ({playerProfile.best_opponent.avg.toFixed(1)} avg)
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {playerProfile.elite_matchups.map(t => (
                    <Badge key={t} variant="default" className="bg-chart-2/20 text-chart-2 text-xs">
                      {t} 🔥
                    </Badge>
                  ))}
                  {playerProfile.good_matchups.map(t => (
                    <Badge key={t} variant="secondary" className="text-xs">
                      {t} ✓
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-1">
                <TrendingUp className="h-4 w-4 text-chart-2" />
                Elite Matchups ({eliteMatchups.length})
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  eliteMatchups.slice(0, 10).map((m, i) => (
                    <div key={i} className="flex justify-between text-sm p-2 rounded bg-muted/20">
                      <span>{m.player_name}</span>
                      <span className="text-muted-foreground">
                        vs {m.opponent}: {m.avg_3pt_vs_team.toFixed(1)} avg (min {m.worst_3pt_vs_team})
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </TabsContent>

          {/* Win Patterns Tab */}
          <TabsContent value="patterns" className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-chart-2/10">
                <p className="text-2xl font-bold text-chart-2">{patterns.totalWins}</p>
                <p className="text-xs text-muted-foreground">Wins</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="text-2xl font-bold">{patterns.totalRecorded}</p>
                <p className="text-xs text-muted-foreground">Recorded</p>
              </div>
              <div className="p-3 rounded-lg bg-primary/10">
                <p className="text-2xl font-bold text-primary">{patterns.winRate}%</p>
                <p className="text-xs text-muted-foreground">Win Rate</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">Line Range Success</h4>
              <div className="flex gap-2">
                {Object.entries(patterns.lineRangeSuccess).map(([line, count]) => (
                  <Badge key={line} variant="outline" className="text-xs">
                    {line}: {count}
                  </Badge>
                ))}
              </div>
            </div>

            {winningPlayers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-1">
                  <Trophy className="h-4 w-4 text-yellow-500" />
                  Top Winning Players
                </h4>
                <div className="flex flex-wrap gap-1">
                  {winningPlayers.slice(0, 8).map(({ player, hits }) => (
                    <Badge key={player} variant="secondary" className="text-xs">
                      {player} ({hits}x)
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Record Win Tab */}
          <TabsContent value="record" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Player name"
                value={newLeg.player}
                onChange={(e) => setNewLeg({ ...newLeg, player: e.target.value })}
                className="flex-1"
              />
              <Input
                type="number"
                step="0.5"
                value={newLeg.line}
                onChange={(e) => setNewLeg({ ...newLeg, line: parseFloat(e.target.value) })}
                className="w-20"
              />
              <Button size="icon" onClick={addLeg}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {quickLegs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Legs ({quickLegs.length})</h4>
                <div className="flex flex-wrap gap-1">
                  {quickLegs.map((leg, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {leg.player} O{leg.line}
                    </Badge>
                  ))}
                </div>
                <Button 
                  onClick={recordWin} 
                  disabled={isRecording}
                  className="w-full"
                  variant="neon"
                >
                  <Trophy className="h-4 w-4 mr-2" />
                  Record Win
                </Button>
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Recent: {outcomes.slice(0, 3).map(o => 
                `${o.total_legs}-leg ${o.outcome}`
              ).join(', ') || 'No records yet'}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
