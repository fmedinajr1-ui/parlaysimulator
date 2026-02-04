import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, TrendingUp, TrendingDown, Minus, Target, Crosshair, Flame } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ZoneAdvantageBar } from './ZoneAdvantageBar';
import type { PlayerMatchupAnalysis, PropEdgeType } from '@/types/matchupScanner';
import { ZONE_DISPLAY_NAMES, ZONE_SHORT_LABELS } from '@/types/matchupScanner';

interface MatchupGradeCardProps {
  analysis: PlayerMatchupAnalysis;
  onAddToBuilder?: (analysis: PlayerMatchupAnalysis) => void;
}

// Side-based styling
const sideStyles = {
  over: {
    border: 'border-l-4 border-l-green-500',
    bg: 'bg-green-500/5',
    icon: TrendingUp,
    label: 'OVER',
    color: 'text-green-400',
  },
  under: {
    border: 'border-l-4 border-l-red-500',
    bg: 'bg-red-500/5',
    icon: TrendingDown,
    label: 'UNDER',
    color: 'text-red-400',
  },
  pass: {
    border: 'border-l-4 border-l-muted',
    bg: 'bg-muted/20',
    icon: Minus,
    label: 'PASS',
    color: 'text-muted-foreground',
  },
};

// Prop type configuration with icons
const propTypeConfig: Record<PropEdgeType, { label: string; icon: typeof Target | null; color: string }> = {
  points: { label: 'POINTS', icon: Target, color: 'text-amber-400' },
  threes: { label: '3PT', icon: Crosshair, color: 'text-cyan-400' },
  both: { label: 'PTS & 3PT', icon: Flame, color: 'text-purple-400' },
  none: { label: '', icon: null, color: 'text-muted-foreground' },
};

// Strength labels
const strengthLabels = {
  strong: 'Strong Edge',
  moderate: 'Good Edge',
  lean: 'Slight Edge',
};

export function MatchupGradeCard({ analysis, onAddToBuilder }: MatchupGradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const style = sideStyles[analysis.recommendedSide];
  const SideIcon = style.icon;
  const propConfig = propTypeConfig[analysis.propEdgeType];
  const PropIcon = propConfig.icon;
  const strengthLabel = strengthLabels[analysis.sideStrength];
  
  // Format game time
  const gameTime = new Date(analysis.gameTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  
  return (
    <Card className={cn("overflow-hidden", style.border, style.bg)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardContent className="p-3">
          {/* Header Row - Rank + Score + Name */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-3">
              {/* Rank */}
              <div className="text-xs text-muted-foreground font-medium w-6">
                #{analysis.rank}
              </div>
              
              {/* Score Badge */}
              <div className={cn(
                "px-2 py-1 rounded text-sm font-bold tabular-nums",
                analysis.recommendedSide === 'over' && "bg-green-500/20 text-green-400",
                analysis.recommendedSide === 'under' && "bg-red-500/20 text-red-400",
                analysis.recommendedSide === 'pass' && "bg-muted text-muted-foreground"
              )}>
                {analysis.overallScore > 0 ? '+' : ''}{analysis.overallScore.toFixed(1)}
              </div>
              
              {/* Player Name */}
              <div>
                <div className="font-semibold text-foreground">
                  {analysis.playerName}
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center gap-1">
              {onAddToBuilder && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => onAddToBuilder(analysis)}
                >
                  <Plus size={14} />
                </Button>
              )}
              
              <CollapsibleTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>
          
          {/* PROMINENT PROP TYPE + SIDE ROW */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {PropIcon && (
                <PropIcon size={18} className={propConfig.color} />
              )}
              <span className={cn("text-base font-bold", style.color)}>
                {propConfig.label} {style.label}
              </span>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs",
                analysis.sideStrength === 'strong' && "bg-amber-500/20 text-amber-400 border-amber-500/40",
                analysis.sideStrength === 'moderate' && "bg-muted text-foreground",
                analysis.sideStrength === 'lean' && "text-muted-foreground"
              )}
            >
              {strengthLabel}
            </Badge>
          </div>
          
          {/* Simple Reason */}
          <p className="text-sm text-muted-foreground mb-2 italic">
            "{analysis.simpleReason}"
          </p>
          
          {/* Game Info */}
          <div className="text-xs text-muted-foreground">
            {analysis.teamAbbrev} vs {analysis.opponentAbbrev} • {gameTime} ET
          </div>
          
          {/* Expanded Content */}
          <CollapsibleContent>
            <div className="mt-3 pt-3 border-t border-border space-y-3">
              {/* Full Zone Breakdown */}
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Zone Breakdown
                </h4>
                {analysis.zones.map((zone) => (
                  <ZoneAdvantageBar key={zone.zone} zone={zone} />
                ))}
              </div>
              
              {/* Exploitable Zones */}
              {analysis.exploitableZones.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-green-400 mb-1 flex items-center gap-1">
                    <TrendingUp size={12} />
                    OVER Zones
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {analysis.exploitableZones.map((zone) => (
                      <Badge key={zone} variant="outline" className="text-xs text-green-400 border-green-500/30">
                        {ZONE_SHORT_LABELS[zone]}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Avoid Zones */}
              {analysis.avoidZones.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-red-400 mb-1 flex items-center gap-1">
                    <TrendingDown size={12} />
                    UNDER Zones
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {analysis.avoidZones.map((zone) => (
                      <Badge key={zone} variant="outline" className="text-xs text-red-400 border-red-500/30">
                        {ZONE_SHORT_LABELS[zone]}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Primary Zone Info */}
              <div className="p-2 bg-muted/50 rounded-md">
                <p className="text-xs text-muted-foreground">
                  Primary zone: <span className="font-medium text-foreground">{ZONE_DISPLAY_NAMES[analysis.primaryZone]}</span>
                  {' '}({(analysis.primaryZoneFrequency * 100).toFixed(0)}% of shots)
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Grade: <span className="font-medium text-foreground">{analysis.overallGrade}</span>
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
