import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Activity, 
  Clock, 
  AlertCircle, 
  Radio,
  Database,
  Zap
} from "lucide-react";
import { FeedHealth } from "@/hooks/useWhaleProxy";
import { formatTimeAgo } from "@/lib/whaleUtils";
import { cn } from "@/lib/utils";

interface WhaleFeedHealthProps {
  feedHealth: FeedHealth;
  lastUpdate: Date;
}

export function WhaleFeedHealth({ feedHealth, lastUpdate }: WhaleFeedHealthProps) {
  const ppLagSeconds = feedHealth.lastPpSnapshot 
    ? Math.floor((Date.now() - feedHealth.lastPpSnapshot.getTime()) / 1000)
    : null;
  
  const bookLagSeconds = feedHealth.lastBookSnapshot 
    ? Math.floor((Date.now() - feedHealth.lastBookSnapshot.getTime()) / 1000)
    : null;

  const getLagColor = (seconds: number | null) => {
    if (seconds === null) return 'text-muted-foreground';
    if (seconds < 10) return 'text-emerald-400';
    if (seconds < 30) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <Card className="bg-card/30 border-border/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">Feed Health</span>
          {feedHealth.isLive && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] gap-1">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              LIVE
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* PP Snapshot */}
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last PP Snap
            </div>
            <div className={cn("font-medium", getLagColor(ppLagSeconds))}>
              {feedHealth.lastPpSnapshot 
                ? formatTimeAgo(feedHealth.lastPpSnapshot)
                : 'No data'
              }
            </div>
          </div>

          {/* Book Snapshot */}
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last Book Snap
            </div>
            <div className={cn("font-medium", getLagColor(bookLagSeconds))}>
              {feedHealth.lastBookSnapshot 
                ? formatTimeAgo(feedHealth.lastBookSnapshot)
                : 'No data'
              }
            </div>
          </div>

          {/* Props Tracked */}
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <Database className="w-3 h-3" />
              Props Tracked
            </div>
            <div className="font-medium text-foreground">
              {feedHealth.propsTracked}
            </div>
          </div>

          {/* Errors */}
          <div className="space-y-1">
            <div className="text-muted-foreground flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Errors
            </div>
            <div className={cn(
              "font-medium",
              feedHealth.errorCount > 0 ? 'text-red-400' : 'text-emerald-400'
            )}>
              {feedHealth.errorCount}
            </div>
          </div>
        </div>

        {/* Lag Warning */}
        {(ppLagSeconds !== null && ppLagSeconds > 30) && (
          <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Feed lag detected ({ppLagSeconds}s). Picks may be stale.</span>
          </div>
        )}

        {/* No Data Warning */}
        {!feedHealth.isLive && feedHealth.propsTracked === 0 && (
          <div className="mt-3 p-2 bg-muted/50 border border-border/30 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 shrink-0" />
            <span>Pipeline is waiting for upcoming games. Signals will appear when markets are active.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
