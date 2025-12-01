import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { americanToImplied } from "@/lib/parlay-calculator";

interface LegInput {
  id: string;
  description: string;
  odds: string;
}

interface LegResult {
  description: string;
  riskLevel: 'safe' | 'caution' | 'danger';
  sharpSignals: any[];
  hasSharpData: boolean;
  warnings: string[];
}

interface UploadOptimizerProps {
  legs: LegInput[];
  quickCheckResults: {
    legs: LegResult[];
    overallRisk: 'safe' | 'caution' | 'danger';
    hasSharpConflicts: boolean;
    suggestedAction: string;
  };
  onRemoveLegs: (legIds: string[]) => void;
  onDismiss: () => void;
}

export function UploadOptimizer({ legs, quickCheckResults, onRemoveLegs, onDismiss }: UploadOptimizerProps) {
  // Identify problematic legs
  const problematicLegs = legs
    .map((leg, idx) => ({
      leg,
      result: quickCheckResults.legs[idx],
      index: idx
    }))
    .filter(({ result }) => result && (result.riskLevel === 'danger' || result.riskLevel === 'caution'))
    .sort((a, b) => {
      // Sort danger first, then caution
      if (a.result.riskLevel === 'danger' && b.result.riskLevel !== 'danger') return -1;
      if (a.result.riskLevel !== 'danger' && b.result.riskLevel === 'danger') return 1;
      return 0;
    });

  if (problematicLegs.length === 0) {
    return null; // No optimization needed
  }

  // Calculate current combined probability
  const validLegs = legs.filter(l => l.odds && !isNaN(parseInt(l.odds)));
  const currentProb = validLegs.length > 0
    ? validLegs.reduce((acc, leg) => {
        const implied = americanToImplied(parseInt(leg.odds));
        return acc * (implied / 100);
      }, 1) * 100
    : 0;

  // Calculate optimized probability (removing problematic legs)
  const problematicIds = new Set(problematicLegs.map(p => p.leg.id));
  const optimizedLegs = validLegs.filter(l => !problematicIds.has(l.id));
  const optimizedProb = optimizedLegs.length > 0
    ? optimizedLegs.reduce((acc, leg) => {
        const implied = americanToImplied(parseInt(leg.odds));
        return acc * (implied / 100);
      }, 1) * 100
    : 0;

  const probImprovement = optimizedProb - currentProb;
  const dangerCount = problematicLegs.filter(p => p.result.riskLevel === 'danger').length;

  const handleOptimize = () => {
    const idsToRemove = problematicLegs.map(p => p.leg.id);
    onRemoveLegs(idsToRemove);
  };

  return (
    <Card className="p-4 space-y-4 border-neon-orange/30 bg-neon-orange/5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-neon-orange" />
          <h3 className="font-semibold text-foreground">Optimization Available</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="p-3 rounded-lg bg-background/50 border border-border/50">
        <p className="text-sm font-medium text-foreground mb-2">
          {dangerCount > 0 ? (
            <>
              {dangerCount} leg{dangerCount > 1 ? 's' : ''} with <span className="text-neon-red">trap signals</span> detected
            </>
          ) : (
            <>
              {problematicLegs.length} leg{problematicLegs.length > 1 ? 's' : ''} flagged for review
            </>
          )}
        </p>
        
        {validLegs.length >= 2 && optimizedLegs.length >= 2 && (
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Current Win %:</span>
              <Badge variant="outline" className="font-mono">
                {currentProb.toFixed(1)}%
              </Badge>
            </div>
            <TrendingUp className="w-3 h-3 text-neon-green" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Optimized:</span>
              <Badge variant="outline" className="font-mono text-neon-green border-neon-green/50">
                {optimizedProb.toFixed(1)}%
              </Badge>
              <span className="text-neon-green font-medium">
                (+{probImprovement.toFixed(1)}%)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Problematic Legs */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Legs to Remove:
        </p>
        {problematicLegs.map(({ leg, result, index }) => (
          <div
            key={leg.id}
            className={cn(
              "p-2.5 rounded-lg border flex items-start gap-2",
              result.riskLevel === 'danger' && "bg-neon-red/10 border-neon-red/30",
              result.riskLevel === 'caution' && "bg-neon-yellow/10 border-neon-yellow/30"
            )}
          >
            <AlertTriangle className={cn(
              "w-4 h-4 shrink-0 mt-0.5",
              result.riskLevel === 'danger' && "text-neon-red",
              result.riskLevel === 'caution' && "text-neon-yellow"
            )} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                #{index + 1} {leg.description}
              </p>
              {result.sharpSignals.length > 0 && (
                <p className={cn(
                  "text-xs mt-1",
                  result.riskLevel === 'danger' && "text-neon-red",
                  result.riskLevel === 'caution' && "text-neon-yellow"
                )}>
                  {result.sharpSignals[0].message}
                </p>
              )}
              {result.warnings.length > 0 && !result.sharpSignals.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  {result.warnings[0]}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button
          variant="default"
          className="flex-1 bg-neon-orange hover:bg-neon-orange/80 text-background font-semibold"
          onClick={handleOptimize}
        >
          <Zap className="w-4 h-4 mr-2" />
          Remove {problematicLegs.length} Weak Leg{problematicLegs.length > 1 ? 's' : ''}
        </Button>
        <Button
          variant="outline"
          onClick={onDismiss}
        >
          Keep All
        </Button>
      </div>

      {/* Warning */}
      {dangerCount > 0 && (
        <p className="text-xs text-neon-red text-center">
          ⚠️ Trap signals detected - sharp money analysis suggests fading these picks
        </p>
      )}
    </Card>
  );
}
