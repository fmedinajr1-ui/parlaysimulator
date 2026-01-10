import { PropResult, ParlayLeg } from "@/hooks/usePropResults";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Trophy, XCircle, MinusCircle, Zap, Flame, ChevronDown, ChevronUp, Check, X, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

interface ParlayResultCardProps {
  result: PropResult;
}

function formatPropType(propType: string): string {
  const mapping: Record<string, string> = {
    'player_points': 'PTS',
    'player_rebounds': 'REB',
    'player_assists': 'AST',
    'player_threes': '3PM',
    'player_blocks': 'BLK',
    'player_steals': 'STL',
    'player_points_rebounds': 'P+R',
    'player_points_assists': 'P+A',
    'player_rebounds_assists': 'R+A',
    'player_points_rebounds_assists': 'PRA',
    'points': 'PTS',
    'rebounds': 'REB',
    'assists': 'AST',
    'pra': 'PRA',
  };
  return mapping[propType.toLowerCase()] || propType.toUpperCase();
}

type OutcomeType = 'hit' | 'miss' | 'push' | 'partial' | 'pending';

const outcomeConfig: Record<OutcomeType, { icon: any; label: string; className: string; iconClass: string }> = {
  hit: {
    icon: Trophy,
    label: 'WON',
    className: 'bg-green-500/20 text-green-400 border-green-500/30',
    iconClass: 'text-green-400',
  },
  miss: {
    icon: XCircle,
    label: 'LOST',
    className: 'bg-red-500/20 text-red-400 border-red-500/30',
    iconClass: 'text-red-400',
  },
  push: {
    icon: MinusCircle,
    label: 'PUSH',
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    iconClass: 'text-amber-400',
  },
  partial: {
    icon: Clock,
    label: 'IN PROGRESS',
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    iconClass: 'text-blue-400',
  },
  pending: {
    icon: AlertCircle,
    label: 'PENDING',
    className: 'bg-muted/50 text-muted-foreground border-border/50',
    iconClass: 'text-muted-foreground',
  },
};

export function ParlayResultCard({ result }: ParlayResultCardProps) {
  const [expanded, setExpanded] = useState(false);

  const config = outcomeConfig[result.outcome] || outcomeConfig.pending;
  const Icon = config.icon;
  const SourceIcon = result.source === 'sharp' ? Zap : Flame;
  const sourceColor = result.source === 'sharp' ? 'text-amber-400' : 'text-orange-400';
  const sourceLabel = result.source === 'sharp' ? 'Sharp AI' : 'Heat Engine';

  const hitsCount = result.legs?.filter(l => l.outcome === 'hit').length || 0;
  const missCount = result.legs?.filter(l => l.outcome === 'miss').length || 0;
  const verifiedCount = result.verified_legs_count || result.legs?.filter(l => l.outcome && l.outcome !== 'pending').length || 0;
  const totalLegs = result.legs?.length || 0;
  const isPartial = result.outcome === 'partial' || result.outcome === 'pending';
  const hasBusted = missCount > 0;

  return (
    <Card className={cn("border transition-all", config.className)}>
      <CardContent className="p-4">
        <div 
          className="flex items-start justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", config.className)}>
              <Icon className={cn("w-5 h-5", config.iconClass)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <SourceIcon className={cn("w-4 h-4", sourceColor)} />
                <span className="font-semibold">{sourceLabel}</span>
                <Badge variant="outline" className="text-xs">
                  {result.parlay_type || result.prop_type}
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {isPartial ? (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {verifiedCount}/{totalLegs} verified
                    </span>
                    {hitsCount > 0 && (
                      <span className="text-sm text-green-400">
                        • {hitsCount} hit
                      </span>
                    )}
                    {hasBusted && (
                      <span className="text-sm text-red-400 font-medium">
                        • BUSTED
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {hitsCount}/{totalLegs} legs hit
                  </span>
                )}
                {result.total_odds && (
                  <span className="text-sm text-muted-foreground">
                    • +{result.total_odds.toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn("text-xs font-bold", config.className)}>
              {hasBusted && isPartial ? 'BUSTED' : config.label}
            </Badge>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Verification Progress Bar */}
        {isPartial && totalLegs > 0 && (
          <div className="mt-3">
            <div className="flex gap-1">
              {result.legs?.map((leg, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all",
                    leg.outcome === 'hit' && "bg-green-500",
                    leg.outcome === 'miss' && "bg-red-500",
                    leg.outcome === 'push' && "bg-amber-500",
                    (!leg.outcome || leg.outcome === 'pending') && "bg-muted animate-pulse"
                  )}
                />
              ))}
            </div>
          </div>
        )}

        {/* Expanded Leg Details */}
        {expanded && result.legs && result.legs.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/50 space-y-2">
            {result.legs.map((leg, idx) => (
              <LegRow key={idx} leg={leg} />
            ))}
            {result.settled_at && (
              <div className="pt-2 text-xs text-muted-foreground text-right">
                Settled: {format(new Date(result.settled_at), 'MMM d, h:mm a')}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LegRow({ leg }: { leg: ParlayLeg }) {
  const isHit = leg.outcome === 'hit';
  const isMiss = leg.outcome === 'miss';
  const isPush = leg.outcome === 'push';

  return (
    <div className={cn(
      "flex items-center justify-between p-2 rounded-lg",
      isHit && "bg-green-500/10",
      isMiss && "bg-red-500/10",
      isPush && "bg-amber-500/10",
      !leg.outcome && "bg-muted/50"
    )}>
      <div className="flex items-center gap-2">
        {isHit && <Check className="w-4 h-4 text-green-400" />}
        {isMiss && <X className="w-4 h-4 text-red-400" />}
        {isPush && <MinusCircle className="w-3 h-3 text-amber-400" />}
        {!leg.outcome && <div className="w-4 h-4 rounded-full bg-muted" />}
        <span className="text-sm font-medium">{leg.player_name}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {formatPropType(leg.prop_type)} {leg.side.charAt(0).toUpperCase()}{leg.line}
        </span>
        {leg.actual_value !== undefined && leg.actual_value !== null && (
          <Badge 
            variant="outline" 
            className={cn(
              "text-xs",
              isHit && "border-green-500/50 text-green-400",
              isMiss && "border-red-500/50 text-red-400",
              isPush && "border-amber-500/50 text-amber-400"
            )}
          >
            {leg.actual_value}
          </Badge>
        )}
      </div>
    </div>
  );
}
