import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlayerNewsDetail } from "@/hooks/usePlayerNewsDetail";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Activity, TrendingUp, TrendingDown, Minus, AlertTriangle, Calendar, Target } from "lucide-react";
import type { NewsItem } from "@/hooks/useGameNewsStream";

interface PlayerNewsDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newsItem: NewsItem | null;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  out: { label: 'OUT', className: 'bg-destructive text-destructive-foreground' },
  doubtful: { label: 'DOUBTFUL', className: 'bg-neon-orange/20 text-neon-orange border-neon-orange/30' },
  questionable: { label: 'QUESTIONABLE', className: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30' },
  probable: { label: 'PROBABLE', className: 'bg-neon-green/20 text-neon-green border-neon-green/30' },
  day_to_day: { label: 'DAY-TO-DAY', className: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30' },
};

function getStatusConfig(status: string) {
  const normalized = status.toLowerCase().replace(/[- ]/g, '_');
  return STATUS_CONFIG[normalized] || { label: status.toUpperCase(), className: 'bg-muted text-muted-foreground' };
}

function TrendIcon({ direction }: { direction: string | null }) {
  if (direction === 'up') return <TrendingUp className="w-4 h-4 text-neon-green" />;
  if (direction === 'down') return <TrendingDown className="w-4 h-4 text-destructive" />;
  return <Minus className="w-4 h-4 text-muted-foreground" />;
}

function HitStreakDots({ streak }: { streak: string | null }) {
  if (!streak) return null;
  
  return (
    <div className="flex gap-0.5">
      {streak.split('').slice(-5).map((char, i) => (
        <div
          key={i}
          className={cn(
            "w-2 h-2 rounded-full",
            char === 'W' || char === '✓' ? "bg-neon-green" : "bg-destructive"
          )}
        />
      ))}
    </div>
  );
}

export function PlayerNewsDetailModal({ open, onOpenChange, newsItem }: PlayerNewsDetailModalProps) {
  const playerName = newsItem?.player_name || null;
  const sport = newsItem?.sport || null;
  
  const { injuries, gameLogs, bettingTrends, isLoading, error, teamName } = usePlayerNewsDetail(playerName, sport);

  if (!newsItem) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-left truncate">
                {playerName || 'Player Details'}
              </SheetTitle>
              <SheetDescription className="text-left">
                {teamName && <span>{teamName} • </span>}
                {sport?.toUpperCase().replace('_', ' ')}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
                <p>{error}</p>
              </div>
            ) : (
              <>
                {/* Current News Item */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Current Update
                  </h3>
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                    <p className="text-sm">{newsItem.headline}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {format(new Date(newsItem.created_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                </section>

                {/* Injury History */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Injury History
                  </h3>
                  {injuries.length > 0 ? (
                    <div className="space-y-2">
                      {injuries.map((injury) => {
                        const statusConfig = getStatusConfig(injury.status);
                        return (
                          <div
                            key={injury.id}
                            className="p-3 rounded-lg bg-muted/20 border border-border/30"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={cn("text-[10px]", statusConfig.className)}>
                                {statusConfig.label}
                              </Badge>
                              {injury.is_star_player && (
                                <Badge variant="outline" className="text-[10px] border-neon-yellow/30 text-neon-yellow">
                                  ⭐ Star
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm font-medium">
                              {injury.injury_type || 'Unknown injury'}
                            </p>
                            {injury.injury_detail && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {injury.injury_detail}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-2">
                              Updated: {injury.updated_at ? format(new Date(injury.updated_at), 'MMM d, yyyy') : 'N/A'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No injury history available
                    </p>
                  )}
                </section>

                {/* Recent Game Logs */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" />
                    Recent Games
                  </h3>
                  {gameLogs.length > 0 ? (
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/50">
                            <th className="text-left py-2 pr-2 font-medium text-muted-foreground">Date</th>
                            <th className="text-left py-2 pr-2 font-medium text-muted-foreground">Opp</th>
                            <th className="text-center py-2 px-1 font-medium text-muted-foreground">PTS</th>
                            <th className="text-center py-2 px-1 font-medium text-muted-foreground">REB</th>
                            <th className="text-center py-2 px-1 font-medium text-muted-foreground">AST</th>
                            <th className="text-center py-2 px-1 font-medium text-muted-foreground">3PM</th>
                            <th className="text-center py-2 pl-1 font-medium text-muted-foreground">MIN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gameLogs.slice(0, 5).map((log) => (
                            <tr key={log.id} className="border-b border-border/20 hover:bg-muted/20">
                              <td className="py-2 pr-2">
                                {format(new Date(log.game_date), 'M/d')}
                              </td>
                              <td className="py-2 pr-2">
                                {log.is_home ? 'vs' : '@'} {log.opponent}
                              </td>
                              <td className="text-center py-2 px-1 font-medium">{log.points}</td>
                              <td className="text-center py-2 px-1">{log.rebounds}</td>
                              <td className="text-center py-2 px-1">{log.assists}</td>
                              <td className="text-center py-2 px-1">{log.threes_made}</td>
                              <td className="text-center py-2 pl-1 text-muted-foreground">{log.minutes_played}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No recent game logs available
                    </p>
                  )}
                </section>

                {/* Betting Trends */}
                <section>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Target className="w-3.5 h-3.5" />
                    Betting Trends
                  </h3>
                  {bettingTrends.length > 0 ? (
                    <div className="space-y-2">
                      {bettingTrends.slice(0, 5).map((trend) => (
                        <div
                          key={trend.id}
                          className="p-3 rounded-lg bg-muted/20 border border-border/30"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {trend.prop_type.replace(/_/g, ' ').toUpperCase()}
                              </Badge>
                              <span className="text-sm font-medium">
                                Line: {trend.current_line}
                              </span>
                            </div>
                            <TrendIcon direction={trend.trend_direction} />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3 mt-2">
                            <div className="space-y-1">
                              <p className="text-[10px] text-muted-foreground">OVER Hit Rate</p>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-neon-green rounded-full"
                                    style={{ width: `${Math.min(trend.hit_rate_over, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium">{trend.hit_rate_over.toFixed(0)}%</span>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] text-muted-foreground">UNDER Hit Rate</p>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-neon-cyan rounded-full"
                                    style={{ width: `${Math.min(trend.hit_rate_under, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs font-medium">{trend.hit_rate_under.toFixed(0)}%</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">Streak:</span>
                              <HitStreakDots streak={trend.hit_streak} />
                            </div>
                            {trend.season_avg && (
                              <span className="text-[10px] text-muted-foreground">
                                Season Avg: {trend.season_avg.toFixed(1)}
                              </span>
                            )}
                          </div>

                          {trend.recommended_side && (
                            <div className="mt-2 pt-2 border-t border-border/20">
                              <Badge
                                className={cn(
                                  "text-[10px]",
                                  trend.recommended_side === 'over'
                                    ? "bg-neon-green/20 text-neon-green"
                                    : "bg-neon-cyan/20 text-neon-cyan"
                                )}
                              >
                                Recommended: {trend.recommended_side.toUpperCase()}
                                {trend.confidence_score && ` (${trend.confidence_score.toFixed(0)}% conf)`}
                              </Badge>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No betting trends available
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
