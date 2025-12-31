import React from "react";
import { Link } from "react-router-dom";
import { Radio, ChevronRight, Clock, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useParlayLiveProgress } from "@/hooks/useParlayLiveProgress";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

export function LiveDashboardCard() {
  const { user } = useAuth();
  const { liveParlays, upcomingParlays, liveGames, isLoading } = useParlayLiveProgress();

  if (!user) return null;

  const totalPendingParlays = liveParlays.length + upcomingParlays.length;
  const hasLiveGames = liveGames.length > 0;
  
  // Calculate hitting stats across all live parlays
  const allLiveLegs = liveParlays.flatMap(p => p.legs.filter(l => l.gameStatus === 'in_progress'));
  const hittingLegs = allLiveLegs.filter(l => l.isHitting).length;
  const totalLiveLegs = allLiveLegs.length;

  // Determine status styling
  const allHitting = totalLiveLegs > 0 && hittingLegs === totalLiveLegs;
  const someHitting = hittingLegs > 0 && hittingLegs < totalLiveLegs;

  if (isLoading) {
    return (
      <Card className="p-4 bg-card/50 border-border/50 animate-pulse">
        <div className="h-12 bg-muted rounded" />
      </Card>
    );
  }

  // No pending parlays state
  if (totalPendingParlays === 0) {
    return (
      <Link to="/suggestions">
        <Card className="p-4 bg-card/50 border-border/50 hover:bg-card/80 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Radio className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No Active Bets</p>
                <p className="text-xs text-muted-foreground">Create a parlay to track live</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Link to="/live-dashboard">
      <Card className={cn(
        "p-4 border transition-all hover:scale-[1.01]",
        allHitting && "bg-chart-2/10 border-chart-2/30",
        someHitting && "bg-chart-4/10 border-chart-4/30",
        !allHitting && !someHitting && hasLiveGames && "bg-destructive/10 border-destructive/30",
        !hasLiveGames && "bg-card/50 border-border/50"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center relative",
              hasLiveGames ? "bg-destructive/20" : "bg-muted"
            )}>
              <Radio className={cn(
                "w-5 h-5",
                hasLiveGames ? "text-destructive" : "text-muted-foreground"
              )} />
              {hasLiveGames && (
                <span className="absolute top-0 right-0 w-3 h-3 bg-destructive rounded-full animate-pulse" />
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                {hasLiveGames && (
                  <span className="text-xs font-bold text-destructive uppercase tracking-wider">
                    Live
                  </span>
                )}
                <span className="text-sm font-medium text-foreground">
                  {totalPendingParlays} Parlay{totalPendingParlays !== 1 ? 's' : ''} Tracking
                </span>
              </div>
              
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {hasLiveGames ? (
                  <>
                    <Activity className="w-3 h-3" />
                    {totalLiveLegs > 0 ? (
                      <span className={cn(
                        allHitting && "text-chart-2",
                        someHitting && "text-chart-4"
                      )}>
                        {hittingLegs}/{totalLiveLegs} legs hitting
                      </span>
                    ) : (
                      <span>{liveGames.length} game{liveGames.length !== 1 ? 's' : ''} live</span>
                    )}
                  </>
                ) : (
                  <>
                    <Clock className="w-3 h-3" />
                    <span>{upcomingParlays.length} game{upcomingParlays.length !== 1 ? 's' : ''} upcoming</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <ChevronRight className="w-5 h-5 text-muted-foreground" />
        </div>
      </Card>
    </Link>
  );
}
