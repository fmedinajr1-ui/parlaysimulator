import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Zap, Calculator, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PVSProp, PVS_TIER_CONFIG } from "@/types/pvs";
import { PVSTierBadge } from "./PVSTierBadge";

interface PVSParlayBuilderProps {
  selectedProps: PVSProp[];
  onRemove: (prop: PVSProp) => void;
  onClear: () => void;
}

export function PVSParlayBuilder({ selectedProps, onRemove, onClear }: PVSParlayBuilderProps) {
  const calculateCombinedOdds = () => {
    if (selectedProps.length === 0) return 0;
    
    const decimalOdds = selectedProps.map(prop => {
      const odds = prop.recommended_side === 'over' ? prop.over_price : prop.under_price;
      if (!odds) return 1.91; // Default -110
      return odds > 0 ? (odds / 100 + 1) : (100 / Math.abs(odds) + 1);
    });
    
    const combined = decimalOdds.reduce((acc, odds) => acc * odds, 1);
    const americanOdds = combined >= 2 ? (combined - 1) * 100 : -100 / (combined - 1);
    return Math.round(americanOdds);
  };

  const calculateCombinedPVS = () => {
    if (selectedProps.length === 0) return 0;
    return selectedProps.reduce((acc, prop) => acc + prop.pvs_final_score, 0) / selectedProps.length;
  };

  const calculateWinProbability = () => {
    if (selectedProps.length === 0) return 0;
    return selectedProps.reduce((acc, prop) => acc * (prop.pvs_final_score / 100), 1) * 100;
  };

  const combinedOdds = calculateCombinedOdds();
  const combinedPVS = calculateCombinedPVS();
  const winProbability = calculateWinProbability();

  const formatPropType = (propType: string) => {
    return propType
      .replace('player_', '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <Card className="sticky top-4 border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="h-5 w-5 text-primary" />
            Parlay Builder
          </CardTitle>
          {selectedProps.length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClear}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {selectedProps.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Zap className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Add props to build your parlay</p>
            <p className="text-xs mt-1">Select GOD TIER props for the best results</p>
          </div>
        ) : (
          <>
            {/* Selected Legs */}
            <div className="space-y-2">
              {selectedProps.map((prop, index) => (
                <div 
                  key={prop.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 group"
                >
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {index + 1}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-medium text-sm truncate">{prop.player_name}</span>
                      <PVSTierBadge tier={prop.pvs_tier} size="sm" showEmoji={false} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {prop.recommended_side?.toUpperCase() || 'N/A'} {prop.current_line} {formatPropType(prop.prop_type)}
                    </div>
                  </div>
                  
                  <div className="text-right flex-shrink-0">
                    <div className={cn(
                      "font-mono font-bold text-sm",
                      prop.pvs_final_score >= 85 ? "text-emerald-400" :
                      prop.pvs_final_score >= 70 ? "text-yellow-400" : "text-orange-400"
                    )}>
                      {prop.pvs_final_score.toFixed(0)}
                    </div>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onRemove(prop)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Parlay Stats */}
            <div className="border-t border-border/30 pt-4 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Legs</div>
                  <div className="font-bold text-lg">{selectedProps.length}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Avg PVS</div>
                  <div className={cn(
                    "font-bold text-lg",
                    combinedPVS >= 85 ? "text-emerald-400" :
                    combinedPVS >= 70 ? "text-yellow-400" : "text-orange-400"
                  )}>
                    {combinedPVS.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Odds</div>
                  <div className="font-bold text-lg font-mono text-primary">
                    {combinedOdds > 0 ? `+${combinedOdds}` : combinedOdds}
                  </div>
                </div>
              </div>

              <div className="bg-muted/30 rounded-lg p-3">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Est. Win Probability</span>
                  <span className={cn(
                    "font-bold",
                    winProbability >= 50 ? "text-emerald-400" :
                    winProbability >= 25 ? "text-yellow-400" : "text-orange-400"
                  )}>
                    {winProbability.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full rounded-full transition-all",
                      winProbability >= 50 ? "bg-emerald-500" :
                      winProbability >= 25 ? "bg-yellow-500" : "bg-orange-500"
                    )}
                    style={{ width: `${Math.min(100, winProbability)}%` }}
                  />
                </div>
              </div>

              {/* Tier Breakdown */}
              <div className="flex flex-wrap gap-1">
                {Object.entries(
                  selectedProps.reduce((acc, prop) => {
                    acc[prop.pvs_tier] = (acc[prop.pvs_tier] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([tier, count]) => (
                  <Badge 
                    key={tier}
                    variant="outline"
                    className={cn("text-xs", PVS_TIER_CONFIG[tier as keyof typeof PVS_TIER_CONFIG]?.color)}
                  >
                    {count}x {tier.replace('_', ' ')}
                  </Badge>
                ))}
              </div>
            </div>

            {/* $100 Payout Calculator */}
            <div className="border-t border-border/30 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">$100 wins</span>
                <span className="font-bold text-xl text-primary font-mono">
                  ${((combinedOdds > 0 ? combinedOdds : (100 / Math.abs(combinedOdds)) * 100) + 100).toFixed(0)}
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
