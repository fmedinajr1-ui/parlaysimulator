import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Plus, Check, TrendingUp, TrendingDown, Activity, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PVSProp, PVS_SCORE_COMPONENTS, UsageProjection } from "@/types/pvs";
import { PVSTierBadge } from "./PVSTierBadge";
import { PVSScoreBar } from "./PVSScoreBar";
import { PropUsageMeter } from "./PropUsageMeter";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
interface PVSPropCardProps {
  prop: PVSProp;
  isSelected?: boolean;
  onSelect?: (prop: PVSProp) => void;
}

export function PVSPropCard({ prop, isSelected = false, onSelect }: PVSPropCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isUsageExpanded, setIsUsageExpanded] = useState(false);
  const [usageData, setUsageData] = useState<UsageProjection | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);

  const fetchUsageData = async () => {
    if (usageData || isLoadingUsage) return;
    
    setIsLoadingUsage(true);
    setUsageError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('calculate-player-usage', {
        body: {
          playerName: prop.player_name,
          propType: prop.prop_type,
          line: prop.current_line,
          opponent: prop.game_description?.split(' @ ')?.[1] || prop.game_description?.split(' vs ')?.[1] || null
        }
      });

      if (error) throw error;
      setUsageData(data);
    } catch (err: any) {
      console.error('Error fetching usage data:', err);
      setUsageError('Usage data unavailable');
    } finally {
      setIsLoadingUsage(false);
    }
  };

  const handleUsageToggle = (open: boolean) => {
    setIsUsageExpanded(open);
    if (open) {
      fetchUsageData();
    }
  };

  const getFinalScoreColor = (score: number) => {
    if (score >= 85) return 'text-emerald-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 60) return 'text-orange-400';
    return 'text-red-400';
  };

  const formatPropType = (propType: string) => {
    return propType
      .replace('player_', '')
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatOdds = (odds: number | null) => {
    if (odds === null) return '-';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  return (
    <Card className={cn(
      "transition-all duration-200 border-border/50 hover:border-primary/50",
      isSelected && "border-primary ring-1 ring-primary/30"
    )}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground truncate">{prop.player_name}</h3>
              <PVSTierBadge tier={prop.pvs_tier} size="sm" />
            </div>
            <p className="text-sm text-muted-foreground truncate mt-1">
              {formatPropType(prop.prop_type)} • {prop.game_description}
            </p>
          </div>
          
          <div className="text-right flex-shrink-0">
            <div className={cn("text-2xl font-bold font-mono", getFinalScoreColor(prop.pvs_final_score))}>
              {prop.pvs_final_score.toFixed(0)}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase">PVS Score</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 space-y-3">
        {/* Line and Prices */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            Line: {prop.current_line}
          </Badge>
          
          {prop.true_line && (
            <Badge variant="outline" className="font-mono text-xs">
              True: {prop.true_line}
              {prop.true_line_diff !== 0 && (
                <span className={cn(
                  "ml-1",
                  prop.true_line_diff > 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {prop.true_line_diff > 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                </span>
              )}
            </Badge>
          )}
          
          <div className="flex-1" />
          
          <div className="flex gap-1 text-xs font-mono">
            <span className="text-emerald-400">O {formatOdds(prop.over_price)}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-red-400">U {formatOdds(prop.under_price)}</span>
          </div>
        </div>

        {/* Recommended Side */}
        <div className="flex items-center gap-2">
          <Badge 
            className={cn(
              "font-semibold",
              prop.recommended_side === 'over' 
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                : prop.recommended_side === 'under'
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : "bg-muted text-muted-foreground border-border"
            )}
          >
            {prop.recommended_side === 'over' ? (
              <>▲ OVER {prop.current_line}</>
            ) : prop.recommended_side === 'under' ? (
              <>▼ UNDER {prop.current_line}</>
            ) : (
              <>— No Pick</>
            )}
          </Badge>
          
          {prop.pvs_injury_tax > 0 && (
            <Badge variant="destructive" className="text-xs">
              IVT: -{prop.pvs_injury_tax}
            </Badge>
          )}
          
          {prop.pvs_sharp_score > 50 && (
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
              Sharp +{(prop.pvs_sharp_score * 0.1).toFixed(0)}
            </Badge>
          )}
        </div>

        {/* Expandable Score Breakdown */}
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
              <span className="text-xs">Score Breakdown</span>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              {PVS_SCORE_COMPONENTS.map((component) => (
                <PVSScoreBar
                  key={component.key}
                  label={component.label}
                  score={prop[component.key as keyof PVSProp] as number}
                  weight={component.weight}
                  description={component.description}
                />
              ))}
            </div>
            
            {/* Additional Stats */}
            <div className="pt-2 border-t border-border/30 grid grid-cols-3 gap-2 text-xs">
              <div className="text-center">
                <div className="text-muted-foreground">Sharp</div>
                <div className={cn(
                  "font-mono font-semibold",
                  prop.pvs_sharp_score >= 50 ? "text-purple-400" : "text-muted-foreground"
                )}>
                  {prop.pvs_sharp_score.toFixed(0)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground">IVT Penalty</div>
                <div className={cn(
                  "font-mono font-semibold",
                  prop.pvs_injury_tax > 0 ? "text-red-400" : "text-muted-foreground"
                )}>
                  -{prop.pvs_injury_tax}
                </div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground">Hit Rate</div>
                <div className="font-mono font-semibold text-primary">
                  {prop.hit_rate_score.toFixed(0)}%
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Usage Analysis Section */}
        <Collapsible open={isUsageExpanded} onOpenChange={handleUsageToggle}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground hover:text-foreground">
              <span className="text-xs flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Usage Analysis
              </span>
              {isUsageExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {isLoadingUsage && (
              <div className="space-y-3 pt-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-8 w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </div>
            )}
            {usageError && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                {usageError}
              </div>
            )}
            {usageData && (
              <PropUsageMeter 
                projection={usageData} 
                propType={prop.prop_type}
                line={prop.current_line}
              />
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Add to Parlay Button */}
        {onSelect && (
          <Button
            variant={isSelected ? "secondary" : "default"}
            size="sm"
            className="w-full"
            onClick={() => onSelect(prop)}
          >
            {isSelected ? (
              <>
                <Check className="h-4 w-4 mr-1" />
                Added to Parlay
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-1" />
                Add to Parlay
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
