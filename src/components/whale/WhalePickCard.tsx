import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Zap, 
  AlertTriangle, 
  Snowflake,
  Target
} from "lucide-react";
import { WhalePick, formatTimeUntil, formatTimeAgo } from "@/lib/whaleUtils";
import { cn } from "@/lib/utils";

interface WhalePickCardProps {
  pick: WhalePick;
}

export function WhalePickCard({ pick }: WhalePickCardProps) {
  const getConfidenceBadgeClass = () => {
    switch (pick.confidence) {
      case 'A':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'B':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'C':
        return 'bg-muted text-muted-foreground border-border/50';
      default:
        return '';
    }
  };

  const getSignalIcon = () => {
    switch (pick.signalType) {
      case 'STEAM':
        return <Zap className="w-3 h-3" />;
      case 'DIVERGENCE':
        return <AlertTriangle className="w-3 h-3" />;
      case 'FREEZE':
        return <Snowflake className="w-3 h-3" />;
    }
  };

  const getSignalBadgeClass = () => {
    switch (pick.signalType) {
      case 'STEAM':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'DIVERGENCE':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'FREEZE':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
    }
  };

  const getSportBadgeClass = () => {
    switch (pick.sport) {
      case 'NBA':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'WNBA':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'MLB':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'NHL':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'TENNIS':
        return 'bg-green-500/10 text-green-400 border-green-500/20';
    }
  };

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-foreground truncate">
                {pick.playerName}
              </span>
              <Badge className={cn("text-[10px] px-1.5 py-0", getSportBadgeClass())}>
                {pick.sport}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {pick.matchup}
            </div>
          </div>
          
          {/* Confidence + Score */}
          <div className="flex flex-col items-end gap-1">
            <Badge className={cn("text-xs font-bold", getConfidenceBadgeClass())}>
              {pick.confidence}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Target className="w-3 h-3" />
              <span>{pick.sharpScore}</span>
            </div>
          </div>
        </div>

        {/* Pick Info */}
        <div className="flex items-center gap-3 mb-3">
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium",
            pick.pickSide === 'OVER' 
              ? 'bg-emerald-500/10 text-emerald-400' 
              : 'bg-rose-500/10 text-rose-400'
          )}>
            {pick.pickSide === 'OVER' ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
            <span>{pick.pickSide} {pick.ppLine}</span>
          </div>
          
          <div className="text-sm text-muted-foreground">
            {pick.statType.replace(/_/g, ' ')}
          </div>
          
          <Badge variant="outline" className="text-[10px]">
            {pick.period}
          </Badge>
        </div>

        {/* Signal + Reasons */}
        <div className="flex items-start gap-2 mb-3">
          <Badge className={cn("text-[10px] gap-1 shrink-0", getSignalBadgeClass())}>
            {getSignalIcon()}
            {pick.signalType}
          </Badge>
          
          <div className="flex-1 text-xs text-muted-foreground">
            {pick.whyShort.map((reason, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-primary">•</span>
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/30 pt-2">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>Starts in {formatTimeUntil(pick.startTime)}</span>
          </div>
          <div>
            Expires {formatTimeUntil(pick.expiresAt)} • {formatTimeAgo(pick.createdAt)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
