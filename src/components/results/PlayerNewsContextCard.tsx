import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronDown, 
  ChevronUp, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  AlertTriangle,
  Activity,
  Newspaper,
  Loader2
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PlayerContext {
  playerName: string;
  team: string | null;
  sport: string;
  recentStats: {
    last5Avg: number | null;
    seasonAvg: number | null;
    trend: "hot" | "cold" | "neutral";
    statType: string;
  } | null;
  injuryStatus: {
    status: string;
    details: string | null;
    impactScore: number | null;
  } | null;
  contextNarrative: string;
  keyFactors: string[];
  lastUpdated: string;
}

interface PlayerNewsContextCardProps {
  context: PlayerContext | null;
  isLoading?: boolean;
  error?: string | null;
  compact?: boolean;
}

export function PlayerNewsContextCard({ 
  context, 
  isLoading = false, 
  error = null,
  compact = false 
}: PlayerNewsContextCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading) {
    return (
      <Card className="p-3 bg-muted/30 border-muted animate-pulse">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading context...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-3 bg-destructive/10 border-destructive/30">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      </Card>
    );
  }

  if (!context) {
    return null;
  }

  const getTrendIcon = () => {
    if (!context.recentStats) return null;
    
    switch (context.recentStats.trend) {
      case "hot":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "cold":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTrendBadge = () => {
    if (!context.recentStats) return null;
    
    const variants: Record<string, { className: string; label: string }> = {
      hot: { className: "bg-green-500/20 text-green-400 border-green-500/30", label: "🔥 Hot" },
      cold: { className: "bg-red-500/20 text-red-400 border-red-500/30", label: "❄️ Cold" },
      neutral: { className: "bg-muted text-muted-foreground border-muted", label: "➡️ Steady" },
    };

    const variant = variants[context.recentStats.trend];
    return (
      <Badge variant="outline" className={cn("text-xs", variant.className)}>
        {variant.label}
      </Badge>
    );
  };

  const getInjuryBadge = () => {
    if (!context.injuryStatus) return null;

    const status = context.injuryStatus.status.toLowerCase();
    let className = "bg-muted text-muted-foreground border-muted";
    
    if (status.includes("out")) {
      className = "bg-red-500/20 text-red-400 border-red-500/30";
    } else if (status.includes("doubtful") || status.includes("questionable")) {
      className = "bg-amber-500/20 text-amber-400 border-amber-500/30";
    } else if (status.includes("probable")) {
      className = "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    }

    return (
      <Badge variant="outline" className={cn("text-xs", className)}>
        ⚠️ {context.injuryStatus.status}
      </Badge>
    );
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        {getTrendBadge()}
        {getInjuryBadge()}
        {context.keyFactors.slice(0, 2).map((factor, idx) => (
          <Badge key={idx} variant="outline" className="text-xs bg-muted/50">
            {factor}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <Card className="overflow-hidden border-muted/50 bg-gradient-to-br from-muted/20 to-muted/10">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-3 flex items-start justify-between gap-3 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 mb-1.5">
            <Newspaper className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium text-sm truncate">
              {context.playerName} Context
            </span>
            {context.sport && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {context.sport}
              </Badge>
            )}
          </div>

          {/* Badges row */}
          <div className="flex flex-wrap gap-1.5">
            {getTrendBadge()}
            {getInjuryBadge()}
          </div>

          {/* Narrative preview */}
          <p className={cn(
            "text-sm text-muted-foreground mt-2 leading-relaxed",
            !isExpanded && "line-clamp-2"
          )}>
            {context.contextNarrative}
          </p>
        </div>

        <div className="shrink-0 mt-1">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0 space-y-3 border-t border-muted/30">
              {/* Stats comparison */}
              {context.recentStats && (
                <div className="pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Recent Performance
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/30 rounded-lg p-2.5">
                      <div className="text-xs text-muted-foreground mb-0.5">Last 5 Games</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg font-semibold">
                          {context.recentStats.last5Avg}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {context.recentStats.statType}
                        </span>
                        {getTrendIcon()}
                      </div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2.5">
                      <div className="text-xs text-muted-foreground mb-0.5">Season Avg</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg font-semibold">
                          {context.recentStats.seasonAvg}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {context.recentStats.statType}
                        </span>
                      </div>
                    </div>
                  </div>
                  {context.recentStats.last5Avg && context.recentStats.seasonAvg && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {context.recentStats.last5Avg > context.recentStats.seasonAvg ? (
                        <span className="text-green-400">
                          +{(context.recentStats.last5Avg - context.recentStats.seasonAvg).toFixed(1)} above season average
                        </span>
                      ) : context.recentStats.last5Avg < context.recentStats.seasonAvg ? (
                        <span className="text-red-400">
                          {(context.recentStats.last5Avg - context.recentStats.seasonAvg).toFixed(1)} below season average
                        </span>
                      ) : (
                        <span>Performing at season average</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Injury details */}
              {context.injuryStatus && (
                <div className="pt-2 border-t border-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Injury Report
                    </span>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                    <div className="font-medium text-sm text-amber-400">
                      {context.injuryStatus.status}
                    </div>
                    {context.injuryStatus.details && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {context.injuryStatus.details}
                      </div>
                    )}
                    {context.injuryStatus.impactScore && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Impact Score: {context.injuryStatus.impactScore}/10
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Key factors */}
              {context.keyFactors.length > 0 && (
                <div className="pt-2 border-t border-muted/30">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Key Factors
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {context.keyFactors.map((factor, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs bg-muted/30">
                        {factor}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Last updated */}
              <div className="text-[10px] text-muted-foreground/60 text-right">
                Updated: {new Date(context.lastUpdated).toLocaleString()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
