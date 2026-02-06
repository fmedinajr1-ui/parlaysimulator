import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, TrendingDown, TrendingUp, ArrowRight, Plus, Check, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import type { ContrarianPick, FadeCategory } from '@/hooks/useContrarianParlayBuilder';

interface ContrarianFadeCardProps {
  pick: ContrarianPick;
}

// Separate component for risky fades with expand/collapse
function RiskyFadesSection({ picks }: { picks: ContrarianPick[] }) {
  const [showAll, setShowAll] = useState(false);
  
  if (picks.length === 0) return null;
  
  // Group by category for better visibility
  const grouped = picks.reduce((acc, pick) => {
    const cat = pick.originalCategory;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(pick);
    return acc;
  }, {} as Record<string, ContrarianPick[]>);
  
  const displayPicks = showAll ? picks : picks.slice(0, 8);
  const hasMore = picks.length > 8;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-chart-4 flex items-center gap-2">
          <AlertTriangle size={14} />
          Risky Fades ({picks.length})
        </h3>
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? (
              <>Show Less <ChevronUp size={12} className="ml-1" /></>
            ) : (
              <>View All ({picks.length}) <ChevronDown size={12} className="ml-1" /></>
            )}
          </Button>
        )}
      </div>
      
      {/* Category badges showing distribution */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {Object.entries(grouped).map(([cat, catPicks]) => (
          <Badge 
            key={cat} 
            variant="outline" 
            className="text-xs bg-muted/50"
          >
            {cat}: {catPicks.length}
          </Badge>
        ))}
      </div>
      
      <div className="grid gap-3 md:grid-cols-2">
        {displayPicks.map(pick => (
          <ContrarianFadeCard key={pick.id} pick={pick} />
        ))}
      </div>
      
      {!showAll && hasMore && (
        <p className="text-xs text-muted-foreground text-center">
          +{picks.length - 8} more risky fades hidden
        </p>
      )}
    </div>
  );
}

export function ContrarianFadeCard({ pick }: ContrarianFadeCardProps) {
  const { addLeg, hasLeg } = useParlayBuilder();
  
  const description = `${pick.playerName} ${pick.fadeSide.toUpperCase()} ${pick.line} ${pick.propType}`;
  const isAdded = hasLeg(description);
  
  const handleAdd = () => {
    if (isAdded) return;
    addLeg({
      description,
      odds: -110,
      source: 'sweet-spots',
      playerName: pick.playerName,
      propType: pick.propType,
      line: pick.line,
      side: pick.fadeSide,
      confidenceScore: pick.confidence,
      sourceData: {
        type: 'contrarian-fade',
        originalCategory: pick.originalCategory,
        fadeHitRate: pick.fadeHitRate,
        fadeEdge: pick.fadeEdge
      }
    });
  };
  
  const getEdgeColor = () => {
    if (pick.hasPositiveEdge) return 'text-chart-2';
    if (pick.fadeEdge > -1) return 'text-chart-4';
    return 'text-destructive';
  };
  
  const getConfidenceColor = () => {
    if (pick.confidence >= 70) return 'bg-chart-2/20 text-chart-2 border-chart-2/30';
    if (pick.confidence >= 55) return 'bg-chart-4/20 text-chart-4 border-chart-4/30';
    return 'bg-muted text-muted-foreground border-border';
  };
  
  return (
    <Card className={cn(
      "relative overflow-hidden transition-all",
      pick.hasPositiveEdge 
        ? "border-chart-2/30 bg-chart-2/5" 
        : "border-chart-4/30 bg-chart-4/5"
    )}>
      {/* Fade indicator stripe */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-1",
        pick.hasPositiveEdge ? "bg-chart-2" : "bg-chart-4"
      )} />
      
      <CardContent className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Player & Prop */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-foreground truncate">
                {pick.playerName}
              </span>
              {pick.opponent && (
                <span className="text-xs text-muted-foreground">vs {pick.opponent}</span>
              )}
            </div>
            
            {/* Original → Fade transformation */}
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-muted-foreground line-through">
                {pick.originalSide.toUpperCase()} {pick.line}
              </span>
              <ArrowRight size={14} className="text-muted-foreground" />
              <span className={cn(
                "font-semibold",
                pick.fadeSide === 'over' ? "text-chart-2" : "text-blue-400"
              )}>
                {pick.fadeSide.toUpperCase()} {pick.line} {pick.propType}
              </span>
            </div>
            
            {/* Stats Row */}
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">L10:</span>
                <span className="font-medium">{pick.l10Avg.toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Edge:</span>
                <span className={cn("font-medium", getEdgeColor())}>
                  {pick.fadeEdge > 0 ? '+' : ''}{pick.fadeEdge}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Fade Rate:</span>
                <span className="font-medium text-chart-2">{pick.fadeHitRate.toFixed(0)}%</span>
              </div>
            </div>
          </div>
          
          {/* Right side - badges & action */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5">
              <Badge 
                variant="outline" 
                className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-xs"
              >
                🔄 FADE
              </Badge>
              {pick.hasPositiveEdge ? (
                <Badge variant="outline" className="bg-chart-2/20 text-chart-2 border-chart-2/30 text-xs">
                  <Zap size={10} className="mr-0.5" />
                  +EDGE
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-chart-4/20 text-chart-4 border-chart-4/30 text-xs">
                  <AlertTriangle size={10} className="mr-0.5" />
                  RISKY
                </Badge>
              )}
            </div>
            
            <Badge variant="outline" className={cn("text-xs", getConfidenceColor())}>
              {pick.confidence}% conf
            </Badge>
            
            <Button
              size="sm"
              variant={isAdded ? "secondary" : "outline"}
              onClick={handleAdd}
              disabled={isAdded}
              className={cn(
                "h-7 px-2 text-xs",
                isAdded && "bg-primary/20 border-primary"
              )}
            >
              {isAdded ? <Check className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
              {isAdded ? "Added" : "Add"}
            </Button>
          </div>
        </div>
        
        {/* Category warning */}
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2 text-xs">
            {pick.categoryHitRate < 35 ? (
              <TrendingDown size={12} className="text-destructive" />
            ) : (
              <TrendingUp size={12} className="text-chart-4" />
            )}
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{pick.originalCategory}</span>
              {' '}has only{' '}
              <span className={cn(
                "font-medium",
                pick.categoryHitRate < 35 ? "text-destructive" : "text-chart-4"
              )}>
                {pick.categoryHitRate.toFixed(0)}%
              </span>
              {' '}hit rate → Fading yields ~{pick.fadeHitRate.toFixed(0)}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ContrarianSectionProps {
  picks: ContrarianPick[];
  categoryStats: Array<FadeCategory & { totalPicks: number; smartPicks: number; avgFadeEdge: number }>;
  isLoading: boolean;
  onBuildParlay: () => void;
}

export function ContrarianSection({ picks, categoryStats, isLoading, onBuildParlay }: ContrarianSectionProps) {
  const smartPicks = picks.filter(p => p.hasPositiveEdge);
  const riskyPicks = picks.filter(p => !p.hasPositiveEdge);
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/2 mx-auto" />
            <div className="h-8 bg-muted rounded" />
            <div className="h-8 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (picks.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground">No contrarian fade opportunities found for today</p>
          <p className="text-xs text-muted-foreground mt-1">
            Fades are generated from categories with {"<"}50% historical hit rate
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Header with build button */}
      <Card className="bg-gradient-to-r from-orange-500/10 to-purple-500/10 border-orange-500/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🔄</span>
              <CardTitle className="text-lg">Contrarian Fade Parlay</CardTitle>
            </div>
            {smartPicks.length >= 2 && (
              <Button 
                size="sm" 
                onClick={onBuildParlay}
                className="bg-gradient-to-r from-orange-500 to-purple-500 hover:from-orange-600 hover:to-purple-600"
              >
                <Zap size={14} className="mr-1" />
                Build {Math.min(smartPicks.length, 3)}-Leg Fade
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <p className="text-sm text-muted-foreground">
            These categories lose often — betting the opposite may yield better results.
            <span className="text-chart-2 font-medium"> +EDGE</span> picks have statistical support for the fade.
          </p>
          
          {/* Category breakdown */}
          <div className="flex flex-wrap gap-2 mt-3">
            {categoryStats.map(cat => (
              <Badge 
                key={cat.category} 
                variant="outline"
                className={cn(
                  "text-xs",
                  cat.smartPicks > 0 
                    ? "bg-chart-2/10 text-chart-2 border-chart-2/30"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {cat.category}: {cat.hitRate}% → {cat.smartPicks}/{cat.totalPicks} smart fades
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Smart fades (with positive edge) */}
      {smartPicks.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-chart-2 flex items-center gap-2">
            <Zap size={14} />
            Smart Fades ({smartPicks.length})
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {smartPicks.map(pick => (
              <ContrarianFadeCard key={pick.id} pick={pick} />
            ))}
          </div>
        </div>
      )}
      
      {/* Risky fades (no positive edge) */}
      <RiskyFadesSection picks={riskyPicks} />
    </div>
  );
}
