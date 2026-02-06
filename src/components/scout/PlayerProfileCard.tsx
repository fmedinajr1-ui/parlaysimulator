import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  TrendingUp, 
  TrendingDown, 
  Target, 
  Clock, 
  Film, 
  BarChart3,
  Zap,
  Users
} from "lucide-react";
import { PlayerBehaviorProfile } from "@/hooks/usePlayerProfile";

interface PlayerProfileCardProps {
  profile: PlayerBehaviorProfile;
  compact?: boolean;
}

export function PlayerProfileCard({ profile, compact = false }: PlayerProfileCardProps) {
  const {
    player_name,
    team,
    three_pt_peak_quarters,
    scoring_zone_preferences,
    best_matchups,
    worst_matchups,
    avg_minutes_per_quarter,
    blowout_minutes_reduction,
    quarter_production,
    games_analyzed,
    profile_confidence,
    film_sample_count,
    fatigue_tendency,
  } = profile;

  // Find peak 3PT quarter
  const peakQuarter = three_pt_peak_quarters 
    ? Object.entries(three_pt_peak_quarters).sort((a, b) => b[1] - a[1])[0]
    : null;

  // Find primary zone
  const primaryZone = scoring_zone_preferences
    ? Object.entries(scoring_zone_preferences).sort((a, b) => b[1] - a[1])[0]
    : null;

  if (compact) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{player_name}</span>
              {team && <Badge variant="outline" className="text-xs">{team}</Badge>}
            </div>
            <Badge 
              variant={profile_confidence >= 70 ? "default" : "secondary"}
              className="text-xs"
            >
              {profile_confidence}% confidence
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            {peakQuarter && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Target className="w-3 h-3 text-primary" />
                <span>Peak 3s: {peakQuarter[0].toUpperCase()} ({peakQuarter[1]}%)</span>
              </div>
            )}
            {primaryZone && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <BarChart3 className="w-3 h-3 text-chart-2" />
                <span>{formatZoneName(primaryZone[0])}: {primaryZone[1]}%</span>
              </div>
            )}
            {best_matchups.length > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <TrendingUp className="w-3 h-3 text-green-500" />
                <span>vs {best_matchups[0].opponent}: {best_matchups[0].avg_vs} pts</span>
              </div>
            )}
            {film_sample_count > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <Film className="w-3 h-3 text-purple-500" />
                <span>{film_sample_count} film samples</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{player_name}</CardTitle>
            {team && <Badge variant="outline">{team}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Badge 
              variant={profile_confidence >= 70 ? "default" : "secondary"}
            >
              {profile_confidence}% confidence
            </Badge>
            <span className="text-xs text-muted-foreground">
              {games_analyzed} games analyzed
            </span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs defaultValue="shooting" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="shooting" className="text-xs">
              <Target className="w-3 h-3 mr-1" />
              Shooting
            </TabsTrigger>
            <TabsTrigger value="matchups" className="text-xs">
              <Users className="w-3 h-3 mr-1" />
              Matchups
            </TabsTrigger>
            <TabsTrigger value="rotation" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              Rotation
            </TabsTrigger>
            <TabsTrigger value="film" className="text-xs">
              <Film className="w-3 h-3 mr-1" />
              Film
            </TabsTrigger>
          </TabsList>

          <TabsContent value="shooting" className="space-y-4">
            {/* 3PT by Quarter */}
            {three_pt_peak_quarters && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  3PT Distribution by Quarter
                </h4>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(three_pt_peak_quarters).map(([quarter, pct]) => (
                    <div key={quarter} className="text-center">
                      <div className="text-lg font-bold">{pct}%</div>
                      <div className="text-xs text-muted-foreground">{quarter.toUpperCase()}</div>
                      <Progress value={pct} className="h-1 mt-1" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Zone Preferences */}
            {scoring_zone_preferences && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <BarChart3 className="w-4 h-4 text-chart-2" />
                  Scoring Zone Preferences
                </h4>
                <div className="space-y-2">
                  {Object.entries(scoring_zone_preferences)
                    .sort((a, b) => b[1] - a[1])
                    .map(([zone, pct]) => (
                      <div key={zone} className="flex items-center gap-2">
                        <span className="text-xs w-28 text-muted-foreground">
                          {formatZoneName(zone)}
                        </span>
                        <Progress value={pct} className="flex-1 h-2" />
                        <span className="text-xs font-medium w-10 text-right">{pct}%</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Quarter Production */}
            {quarter_production && (
              <div>
                <h4 className="text-sm font-medium mb-2">Quarter Production (Avg)</h4>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  {Object.entries(quarter_production).map(([quarter, stats]) => (
                    <div key={quarter} className="bg-muted/30 rounded p-2">
                      <div className="font-medium mb-1">{quarter.toUpperCase()}</div>
                      <div className="text-muted-foreground">
                        {stats.pts} pts / {stats.reb} reb / {stats.ast} ast
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="matchups" className="space-y-4">
            {/* Best Matchups */}
            {best_matchups.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  Best Matchups
                </h4>
                <div className="space-y-2">
                  {best_matchups.map((m, i) => (
                    <div key={i} className="flex items-center justify-between bg-green-500/10 rounded px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.opponent}</span>
                        <span className="text-xs text-muted-foreground">({m.games} games)</span>
                      </div>
                      <Badge variant="outline" className="bg-green-500/20 text-green-400">
                        {m.avg_vs} {m.stat}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Worst Matchups */}
            {worst_matchups.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  Worst Matchups
                </h4>
                <div className="space-y-2">
                  {worst_matchups.map((m, i) => (
                    <div key={i} className="flex items-center justify-between bg-red-500/10 rounded px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.opponent}</span>
                        <span className="text-xs text-muted-foreground">({m.games} games)</span>
                      </div>
                      <Badge variant="outline" className="bg-red-500/20 text-red-400">
                        {m.avg_vs} {m.stat}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {best_matchups.length === 0 && worst_matchups.length === 0 && (
              <div className="text-center text-muted-foreground py-4">
                Not enough data for matchup analysis
              </div>
            )}
          </TabsContent>

          <TabsContent value="rotation" className="space-y-4">
            {/* Minutes per Quarter */}
            {avg_minutes_per_quarter && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Minutes Distribution
                </h4>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(avg_minutes_per_quarter).map(([quarter, mins]) => (
                    <div key={quarter} className="text-center bg-muted/30 rounded p-2">
                      <div className="text-lg font-bold">{mins}</div>
                      <div className="text-xs text-muted-foreground">{quarter.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blowout Reduction */}
            {blowout_minutes_reduction !== null && blowout_minutes_reduction > 0 && (
              <div className="bg-amber-500/10 rounded p-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-amber-500" />
                  <span className="text-sm">
                    In blowouts, plays <strong>{blowout_minutes_reduction} fewer minutes</strong> on average
                  </span>
                </div>
              </div>
            )}

            {profile.avg_first_rest_time && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">First Rest:</span>
                  <span className="ml-2 font-medium">{profile.avg_first_rest_time}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Back In:</span>
                  <span className="ml-2 font-medium">{profile.avg_second_stint_start}</span>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="film" className="space-y-4">
            {film_sample_count > 0 ? (
              <>
                <div className="flex items-center gap-2 mb-4">
                  <Film className="w-5 h-5 text-purple-500" />
                  <span className="font-medium">{film_sample_count} film samples analyzed</span>
                </div>

                {fatigue_tendency && (
                  <div className="bg-purple-500/10 rounded p-3">
                    <h4 className="text-sm font-medium mb-1">Fatigue Tendency</h4>
                    <p className="text-sm text-muted-foreground">{fatigue_tendency}</p>
                  </div>
                )}

                {profile.body_language_notes && (
                  <div className="bg-blue-500/10 rounded p-3">
                    <h4 className="text-sm font-medium mb-1">Body Language Notes</h4>
                    <p className="text-sm text-muted-foreground">{profile.body_language_notes}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Film className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No film analyzed yet</p>
                <p className="text-xs mt-1">
                  Upload game footage in Scout to build film-based insights
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function formatZoneName(zone: string): string {
  return zone
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
