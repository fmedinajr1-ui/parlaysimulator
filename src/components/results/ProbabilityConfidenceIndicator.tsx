import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Info, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ConfidenceFactor } from '@/hooks/useEnhancedProbability';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ProbabilityConfidenceIndicatorProps {
  confidenceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'uncertain';
  confidenceFactors: ConfidenceFactor[];
  correlationWarnings?: string[];
  isCalculating?: boolean;
  compact?: boolean;
}

export function ProbabilityConfidenceIndicator({
  confidenceScore,
  confidenceLevel,
  confidenceFactors,
  correlationWarnings = [],
  isCalculating = false,
  compact = false,
}: ProbabilityConfidenceIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getConfidenceColor = () => {
    switch (confidenceLevel) {
      case 'high': return 'text-green-500';
      case 'medium': return 'text-yellow-500';
      case 'low': return 'text-orange-500';
      case 'uncertain': return 'text-red-500';
    }
  };

  const getConfidenceBgColor = () => {
    switch (confidenceLevel) {
      case 'high': return 'bg-green-500/20 border-green-500/30';
      case 'medium': return 'bg-yellow-500/20 border-yellow-500/30';
      case 'low': return 'bg-orange-500/20 border-orange-500/30';
      case 'uncertain': return 'bg-red-500/20 border-red-500/30';
    }
  };

  const getConfidenceLabel = () => {
    switch (confidenceLevel) {
      case 'high': return 'High Confidence';
      case 'medium': return 'Medium Confidence';
      case 'low': return 'Low Confidence';
      case 'uncertain': return 'Uncertain';
    }
  };

  const getConfidenceIcon = () => {
    switch (confidenceLevel) {
      case 'high': return <CheckCircle className="h-3.5 w-3.5" />;
      case 'medium': return <Info className="h-3.5 w-3.5" />;
      case 'low': return <AlertTriangle className="h-3.5 w-3.5" />;
      case 'uncertain': return <AlertTriangle className="h-3.5 w-3.5" />;
    }
  };

  const getFactorIcon = (status: 'good' | 'warning' | 'critical') => {
    switch (status) {
      case 'good': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
      case 'critical': return <AlertTriangle className="h-3 w-3 text-red-500" />;
    }
  };

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border cursor-help",
              getConfidenceBgColor(),
              getConfidenceColor(),
              isCalculating && "animate-pulse"
            )}>
              {getConfidenceIcon()}
              <span>{confidenceScore}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="font-semibold mb-1">{getConfidenceLabel()}</p>
            <p className="text-xs text-muted-foreground">
              Probability reliability based on data quality, correlation analysis, and AI coverage.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border p-3",
      getConfidenceBgColor(),
      isCalculating && "animate-pulse"
    )}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <div className={cn("p-1 rounded-full", getConfidenceBgColor())}>
            {getConfidenceIcon()}
          </div>
          <div className="text-left">
            <div className={cn("text-sm font-bold", getConfidenceColor())}>
              {getConfidenceLabel()}
            </div>
            <div className="text-xs text-muted-foreground">
              {confidenceScore}/100 reliability score
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mini progress bar */}
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className={cn(
                "h-full rounded-full",
                confidenceLevel === 'high' ? "bg-green-500" :
                confidenceLevel === 'medium' ? "bg-yellow-500" :
                confidenceLevel === 'low' ? "bg-orange-500" : "bg-red-500"
              )}
              initial={{ width: 0 }}
              animate={{ width: `${confidenceScore}%` }}
              transition={{ duration: 0.5, delay: 0.2 }}
            />
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
              {/* Confidence Factors */}
              {confidenceFactors.map((factor, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {getFactorIcon(factor.status)}
                    <span className="text-muted-foreground">{factor.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{factor.description}</span>
                    <span className={cn(
                      "font-mono",
                      factor.status === 'good' ? 'text-green-500' :
                      factor.status === 'warning' ? 'text-yellow-500' : 'text-red-500'
                    )}>
                      {factor.score}/{factor.maxScore}
                    </span>
                  </div>
                </div>
              ))}

              {/* Correlation Warnings */}
              {correlationWarnings.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/30">
                  <div className="flex items-center gap-1.5 text-xs text-yellow-500 mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="font-medium">Correlation Warnings</span>
                  </div>
                  {correlationWarnings.slice(0, 3).map((warning, idx) => (
                    <p key={idx} className="text-xs text-muted-foreground pl-4">
                      • {warning}
                    </p>
                  ))}
                </div>
              )}

              {/* Info tooltip */}
              <div className="flex items-start gap-1.5 pt-2 text-xs text-muted-foreground">
                <HelpCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  Higher confidence means more reliable probability estimate. 
                  Factors include AI analysis coverage, correlation data quality, and leg count.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
