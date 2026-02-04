import { useState } from 'react';
import { ChevronDown, ChevronUp, Target, Flame, Crosshair, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ZoneAdvantageBar } from './ZoneAdvantageBar';
import type { PlayerMatchupAnalysis } from '@/types/matchupScanner';
import { GRADE_THRESHOLDS, ZONE_DISPLAY_NAMES, ZONE_SHORT_LABELS } from '@/types/matchupScanner';

interface MatchupGradeCardProps {
  analysis: PlayerMatchupAnalysis;
  onAddToBuilder?: (analysis: PlayerMatchupAnalysis) => void;
}

// Grade badge colors
const gradeColors: Record<string, string> = {
  'A+': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'A': 'bg-green-500/20 text-green-400 border-green-500/30',
  'B+': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'B': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'C': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'D': 'bg-red-500/20 text-red-400 border-red-500/30',
};

// Boost badge colors
const boostColors = {
  strong: 'bg-green-500/20 text-green-400',
  moderate: 'bg-teal-500/20 text-teal-400',
  neutral: 'bg-gray-500/20 text-gray-400',
  negative: 'bg-red-500/20 text-red-400',
};

export function MatchupGradeCard({ analysis, onAddToBuilder }: MatchupGradeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const gradeInfo = GRADE_THRESHOLDS[analysis.overallGrade];
  
  return (
    <Card className="overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardContent className="p-3">
          {/* Header Row */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg border",
                gradeColors[analysis.overallGrade]
              )}>
                {analysis.overallGrade}
              </div>
              <div>
                <div className="font-semibold text-foreground">
                  {analysis.playerName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {analysis.teamAbbrev} vs {analysis.opponentAbbrev}
                </div>
              </div>
            </div>
            
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
          
          {/* Zone Advantage Chips */}
          <div className="flex flex-wrap gap-1 mb-2">
            {analysis.zones.slice(0, 4).map((zone) => (
              <ZoneAdvantageBar key={zone.zone} zone={zone} compact />
            ))}
          </div>
          
          {/* Recommendation */}
          <div className="flex items-center gap-2 flex-wrap">
            {analysis.scoringBoost !== 'neutral' && (
              <Badge className={cn("text-xs gap-1", boostColors[analysis.scoringBoost])}>
                <Target size={10} />
                PTS {analysis.scoringBoost === 'strong' ? '🔥' : analysis.scoringBoost === 'negative' ? '❄️' : ''}
              </Badge>
            )}
            {analysis.threesBoost !== 'neutral' && (
              <Badge className={cn("text-xs gap-1", boostColors[analysis.threesBoost])}>
                <Crosshair size={10} />
                3PT {analysis.threesBoost === 'strong' ? '🔥' : analysis.threesBoost === 'negative' ? '❄️' : ''}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground flex-1">
              Primary: {ZONE_DISPLAY_NAMES[analysis.primaryZone]} ({(analysis.primaryZoneFrequency * 100).toFixed(0)}%)
            </span>
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
                    <Flame size={12} />
                    Attack Zones
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
                  <h4 className="text-xs font-medium text-red-400 mb-1">
                    ⚠️ Avoid Zones
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
              
              {/* Recommendation */}
              <div className="p-2 bg-muted/50 rounded-md">
                <p className="text-sm font-medium">{analysis.recommendation}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Score: {analysis.overallScore.toFixed(1)} • {gradeInfo.label}
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
