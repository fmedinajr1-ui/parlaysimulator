import { useState } from "react";
import { AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronUp, Shield, Target } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface TrapSignal {
  signal: string;
  points: number;
  reason: string;
  category: 'trap' | 'safe';
}

interface TrapProbabilityBadgeProps {
  trapProbability: number;
  riskLabel: 'Low' | 'Medium' | 'High';
  recommendation: 'Play' | 'Reduce Line' | 'Avoid';
  explanation: string;
  triggeredSignals?: TrapSignal[];
  compact?: boolean;
}

export function TrapProbabilityBadge({
  trapProbability,
  riskLabel,
  recommendation,
  explanation,
  triggeredSignals = [],
  compact = false
}: TrapProbabilityBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const getConfig = () => {
    switch (riskLabel) {
      case 'Low':
        return {
          icon: CheckCircle,
          bgClass: 'bg-green-500/10 border-green-500/30',
          textClass: 'text-green-500',
          label: '✓ Low Trap Risk',
          shortLabel: 'Low',
          emoji: '✓'
        };
      case 'Medium':
        return {
          icon: AlertTriangle,
          bgClass: 'bg-yellow-500/10 border-yellow-500/30',
          textClass: 'text-yellow-500',
          label: '⚠️ Medium Trap Risk',
          shortLabel: 'Med',
          emoji: '⚠️'
        };
      case 'High':
        return {
          icon: XCircle,
          bgClass: 'bg-red-500/10 border-red-500/30',
          textClass: 'text-red-500',
          label: '🚫 High Trap Risk',
          shortLabel: 'High',
          emoji: '🚫'
        };
    }
  };
  
  const config = getConfig();
  const Icon = config.icon;
  
  const trapSignals = triggeredSignals.filter(s => s.category === 'trap');
  const safeSignals = triggeredSignals.filter(s => s.category === 'safe');
  
  // Compact badge for inline display
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border cursor-help",
              config.bgClass,
              config.textClass
            )}>
              <Icon className="w-3 h-3" />
              <span>{trapProbability}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className={cn("w-4 h-4", config.textClass)} />
                <span className="font-medium">{config.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{explanation}</p>
              <div className={cn("text-xs font-medium px-2 py-1 rounded", config.bgClass, config.textClass)}>
                Recommendation: {recommendation}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  // Full badge with expandable section
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        "rounded-lg border p-3",
        config.bgClass
      )}>
        {/* Header */}
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                riskLabel === 'Low' ? 'bg-green-500/20' : 
                riskLabel === 'Medium' ? 'bg-yellow-500/20' : 'bg-red-500/20'
              )}>
                <Icon className={cn("w-5 h-5", config.textClass)} />
              </div>
              <div className="text-left">
                <div className={cn("font-bold text-sm", config.textClass)}>
                  {config.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {trapProbability}% probability • {recommendation}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {triggeredSignals.length} signals
              </span>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>
        
        {/* Expandable Content - "Why this may be a trap" */}
        <CollapsibleContent>
          <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
            {/* Explanation */}
            <p className="text-sm text-muted-foreground">
              {explanation}
            </p>
            
            {/* Trap Signals */}
            {trapSignals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-400">
                  <Target className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Why this may be a trap
                  </span>
                </div>
                <div className="space-y-2">
                  {trapSignals.map((signal, idx) => (
                    <div 
                      key={idx}
                      className="flex items-start gap-2 p-2 rounded bg-red-500/5 border border-red-500/20"
                    >
                      <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-red-400">
                            {signal.signal.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-red-400/70">
                            +{signal.points} pts
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {signal.reason}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Safe Signals */}
            {safeSignals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-400">
                  <Shield className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Safe indicators
                  </span>
                </div>
                <div className="space-y-2">
                  {safeSignals.map((signal, idx) => (
                    <div 
                      key={idx}
                      className="flex items-start gap-2 p-2 rounded bg-green-500/5 border border-green-500/20"
                    >
                      <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-green-400">
                            {signal.signal.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-green-400/70">
                            {signal.points} pts
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {signal.reason}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Recommendation Box */}
            <div className={cn(
              "p-3 rounded-lg border",
              recommendation === 'Play' ? 'bg-green-500/10 border-green-500/30' :
              recommendation === 'Reduce Line' ? 'bg-yellow-500/10 border-yellow-500/30' :
              'bg-red-500/10 border-red-500/30'
            )}>
              <div className="flex items-center gap-2">
                {recommendation === 'Play' ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : recommendation === 'Reduce Line' ? (
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                <span className={cn(
                  "text-sm font-bold",
                  recommendation === 'Play' ? 'text-green-500' :
                  recommendation === 'Reduce Line' ? 'text-yellow-500' :
                  'text-red-500'
                )}>
                  Recommendation: {recommendation}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {recommendation === 'Play' 
                  ? 'This leg shows minimal trap signals. Proceed with normal sizing.'
                  : recommendation === 'Reduce Line'
                  ? 'Consider reducing your stake or finding alternative lines.'
                  : 'High trap probability detected. Consider removing this leg or fading the opposite side.'}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}