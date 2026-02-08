import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Trophy, Shield, Target, Rocket, Flame, TrendingUp,
  ChevronDown, ChevronUp, Plus, Check
} from "lucide-react";
import { DailyParlay, UnifiedParlayLeg } from "@/hooks/useDailyParlays";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface UnifiedParlayCardProps {
  parlay: DailyParlay;
}

// Card styling based on parlay type
const CARD_STYLES: Record<DailyParlay['type'], {
  icon: typeof Trophy;
  iconColor: string;
  borderColor: string;
  bgGradient: string;
  label: string;
}> = {
  OPTIMAL: {
    icon: Trophy,
    iconColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
    bgGradient: 'bg-gradient-to-br from-amber-500/10 to-background',
    label: 'Optimal 6-Leg',
  },
  SAFE: {
    icon: Shield,
    iconColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
    bgGradient: 'bg-gradient-to-br from-emerald-500/10 to-background',
    label: 'Safe Play',
  },
  CORE: {
    icon: Shield,
    iconColor: 'text-blue-500',
    borderColor: 'border-blue-500/30',
    bgGradient: 'bg-gradient-to-br from-blue-500/10 to-background',
    label: 'Core',
  },
  BALANCED: {
    icon: Target,
    iconColor: 'text-primary',
    borderColor: 'border-primary/30',
    bgGradient: 'bg-gradient-to-br from-primary/10 to-background',
    label: 'Balanced',
  },
  UPSIDE: {
    icon: Rocket,
    iconColor: 'text-purple-500',
    borderColor: 'border-purple-500/30',
    bgGradient: 'bg-gradient-to-br from-purple-500/10 to-background',
    label: 'Upside',
  },
  HEAT_UPSIDE: {
    icon: Flame,
    iconColor: 'text-orange-500',
    borderColor: 'border-orange-500/30',
    bgGradient: 'bg-gradient-to-br from-orange-500/10 to-background',
    label: 'Heat Upside',
  },
};

// Pattern badge colors
function getPatternColor(pattern: string): string {
  const patternLower = pattern.toLowerCase();
  if (patternLower.includes('reb') || patternLower.includes('rebound')) return 'bg-blue-500/20 text-blue-400';
  if (patternLower.includes('ast') || patternLower.includes('assist')) return 'bg-green-500/20 text-green-400';
  if (patternLower.includes('pts') || patternLower.includes('point') || patternLower.includes('scorer')) return 'bg-amber-500/20 text-amber-400';
  if (patternLower.includes('under')) return 'bg-red-500/20 text-red-400';
  if (patternLower.includes('over')) return 'bg-emerald-500/20 text-emerald-400';
  return 'bg-muted text-muted-foreground';
}

// Format odds display
function formatOdds(odds: number): string {
  if (odds >= 0) return `+${odds}`;
  return odds.toString();
}

export function UnifiedParlayCard({ parlay }: UnifiedParlayCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const { addLeg, clearParlay } = useParlayBuilder();
  
  const style = CARD_STYLES[parlay.type];
  const Icon = style.icon;
  
  const handleAddToBuilder = () => {
    if (isAdded) return;
    
    clearParlay();
    
    // Map source to valid ParlaySource types
    const sourceMap: Record<string, 'sharp' | 'suggestions' | 'hitrate'> = {
      'sweet-spot': 'sharp',
      'heat': 'hitrate',
      'sharp': 'suggestions',
    };
    
    parlay.legs.forEach(leg => {
      addLeg({
        source: sourceMap[parlay.source] || 'suggestions',
        description: `${leg.playerName} ${leg.propType} ${leg.side.toUpperCase()} ${leg.line}`,
        odds: -110,
        playerName: leg.playerName,
        propType: leg.propType,
        line: leg.line,
        side: leg.side,
        confidenceScore: leg.confidence,
      });
    });
    
    setIsAdded(true);
    toast.success(`Added ${parlay.legCount}-leg ${style.label} parlay to builder!`);
    
    // Reset after 3 seconds
    setTimeout(() => setIsAdded(false), 3000);
  };
  
  return (
    <Card className={cn("overflow-hidden transition-all", style.borderColor, style.bgGradient)}>
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-5 w-5", style.iconColor)} />
            <CardTitle className="text-sm font-semibold">{style.label}</CardTitle>
          </div>
          <Badge variant="outline" className="text-xs">
            {parlay.legCount} Legs
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Odds and Win Probability */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-primary">
              {formatOdds(parlay.combinedOdds)}
            </div>
            <div className="text-xs text-muted-foreground">
              Combined Odds
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-emerald-500">
              {(parlay.winProbability * 100).toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground">
              Win Prob
            </div>
          </div>
        </div>
        
        {/* Pattern Badges */}
        {parlay.patterns.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {parlay.patterns.slice(0, 4).map((pattern, idx) => (
              <Badge 
                key={idx} 
                variant="outline" 
                className={cn("text-[10px] px-1.5 py-0", getPatternColor(pattern))}
              >
                {pattern.replace(/_/g, ' ')}
              </Badge>
            ))}
            {parlay.patterns.length > 4 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{parlay.patterns.length - 4}
              </Badge>
            )}
          </div>
        )}
        
        {/* Collapsible Leg Details */}
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between h-8 text-xs">
              <span>View Legs</span>
              {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            {parlay.legs.map((leg, idx) => (
              <LegRow key={idx} leg={leg} index={idx + 1} />
            ))}
          </CollapsibleContent>
        </Collapsible>
        
        {/* Add to Builder Button */}
        <Button 
          variant={isAdded ? "outline" : "neon"} 
          size="sm" 
          className="w-full gap-2"
          onClick={handleAddToBuilder}
          disabled={isAdded}
        >
          {isAdded ? (
            <>
              <Check className="h-4 w-4" />
              Added
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add to Builder
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// Edge display helper
function getEdgeBadge(projectedValue: number | undefined, actualLine: number | undefined, side: 'over' | 'under') {
  if (projectedValue == null || actualLine == null) return null;
  
  const edge = side === 'over' 
    ? projectedValue - actualLine 
    : actualLine - projectedValue;
  
  const color = edge >= 2 ? 'bg-emerald-500/20 text-emerald-400' 
              : edge >= 0 ? 'bg-amber-500/20 text-amber-400'
              : 'bg-red-500/20 text-red-400';
  
  const sign = edge >= 0 ? '+' : '';
  
  return { edge, color, label: `${sign}${edge.toFixed(1)}` };
}

// Individual leg row
function LegRow({ leg, index }: { leg: UnifiedParlayLeg; index: number }) {
  const edgeBadge = getEdgeBadge(leg.projectedValue, leg.actualLine ?? leg.line, leg.side);
  const playerName = leg.playerName ?? 'Unknown';
  const propType = leg.propType ?? 'Prop';
  
  return (
    <div className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-muted-foreground font-mono w-4">{index}.</span>
        <div className="truncate">
          <span className="font-medium">{playerName}</span>
          <span className="text-muted-foreground ml-1">
            {propType}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge 
          variant="outline" 
          className={cn(
            "text-[10px] px-1.5",
            leg.side === 'over' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          )}
        >
          {leg.side.toUpperCase()} {leg.line}
        </Badge>
        {/* Projection badge */}
        {leg.projectedValue != null && edgeBadge && (
          <Badge 
            variant="outline" 
            className={cn("text-[10px] px-1.5", edgeBadge.color)}
          >
            Proj: {leg.projectedValue.toFixed(1)} ({edgeBadge.label})
          </Badge>
        )}
        {leg.l10HitRate && (
          <span className="text-emerald-500 font-medium">
            {(leg.l10HitRate * 100).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
