import { useState } from "react";
import { ChevronDown, ChevronUp, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";
import { ShotChartMatchup } from "./ShotChartMatchup";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ZONE_NAMES } from "@/hooks/useShotChartAnalysis";

interface ShotChartPreviewProps {
  spot: DeepSweetSpot;
}

export function ShotChartPreview({ spot }: ShotChartPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const matchup = spot.liveData?.shotChartMatchup;
  
  // Guard: Only for points/threes with matchup data, non-live games
  if (!matchup) return null;
  if (spot.propType !== 'points' && spot.propType !== 'threes') return null;
  if (spot.liveData?.isLive) return null; // HedgeRecommendation handles live games
  
  const score = matchup.overallMatchupScore;
  const isPositive = score > 0;
  const isStrong = Math.abs(score) > 3;
  
  // Find primary zone (highest frequency)
  const primaryZone = matchup.zones.reduce((prev, curr) => 
    curr.playerFrequency > prev.playerFrequency ? curr : prev
  );
  
  // Generate recommendation text
  const propLabel = spot.propType === 'points' ? 'PTS' : '3PM';
  const matchupLabel = isPositive 
    ? (isStrong ? 'Strong advantage' : 'Slight advantage')
    : (isStrong ? 'Disadvantage' : 'Neutral');
  
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger className={cn(
        "w-full flex items-center justify-between gap-2 p-2 rounded-lg transition-colors",
        "hover:bg-muted/50 border",
        isPositive && isStrong && "border-primary/30 bg-primary/5",
        isPositive && !isStrong && "border-teal-500/30 bg-teal-500/5",
        !isPositive && !isStrong && "border-warning/30 bg-warning/5",
        !isPositive && isStrong && "border-destructive/30 bg-destructive/5",
      )}>
        <div className="flex items-center gap-2">
          <Target size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium text-foreground">Shot Chart Matchup</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-xs font-bold px-1.5 py-0.5 rounded",
            isPositive && isStrong && "bg-primary/20 text-primary",
            isPositive && !isStrong && "bg-teal-500/20 text-teal-400",
            !isPositive && !isStrong && "bg-warning/20 text-warning",
            !isPositive && isStrong && "bg-destructive/20 text-destructive",
          )}>
            {isPositive ? '+' : ''}{score.toFixed(1)}
          </span>
          {isExpanded ? (
            <ChevronUp size={14} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="pt-3">
        <div className="flex gap-4">
          {/* Half-court visualization */}
          <ShotChartMatchup analysis={matchup} />
          
          {/* Info panel */}
          <div className="flex-1 space-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Primary Zone:</span>
              <span className="ml-1 font-medium text-foreground">
                {ZONE_NAMES[primaryZone.zone]} ({Math.round(primaryZone.playerFrequency * 100)}%)
              </span>
            </div>
            
            <div>
              <span className="text-muted-foreground">vs</span>
              <span className="ml-1 font-medium text-foreground">
                {spot.opponentName || 'Opponent'} Defense
              </span>
            </div>
            
            <div className={cn(
              "mt-2 p-2 rounded text-[11px] italic",
              isPositive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}>
              {isPositive 
                ? `Favorable ${propLabel} matchup in ${ZONE_NAMES[primaryZone.zone]}`
                : `Challenging ${propLabel} matchup - watch for defensive pressure`
              }
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
