import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Loader2, Check, AlertCircle, Lock, Crown, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { useSmartAnalyze, UserRole, AnalyzeContext } from '@/hooks/useSmartAnalyze';
import { cn } from '@/lib/utils';

interface ParlayLeg {
  eventId?: string;
  playerName?: string;
  propType?: string;
  line?: number;
  side?: string;
  odds?: number;
  sport?: string;
}

interface SmartAnalyzeButtonProps {
  legs?: ParlayLeg[];
  eventId?: string;
  sport?: string;
  variant?: 'default' | 'hero' | 'compact' | 'sticky';
  className?: string;
  onAnalysisComplete?: (results: any) => void;
}

const ROLE_CONFIG: Record<UserRole, { icon: React.ElementType; label: string; color: string }> = {
  guest: { icon: Lock, label: 'Guest', color: 'text-muted-foreground' },
  subscriber: { icon: Crown, label: 'Pro', color: 'text-amber-500' },
  admin: { icon: Shield, label: 'Admin', color: 'text-red-500' },
};

const CONTEXT_LABELS: Record<AnalyzeContext, string> = {
  homepage: 'Trending Analysis',
  single_leg: 'Leg Analysis',
  parlay_builder: 'Full Parlay Analysis',
  live_game: 'Live Analysis',
};

export function SmartAnalyzeButton({
  legs = [],
  eventId,
  sport,
  variant = 'default',
  className,
  onAnalysisComplete,
}: SmartAnalyzeButtonProps) {
  const {
    analyze,
    isRunning,
    progress,
    results,
    lastUpdated,
    userRole,
    analyzeContext,
    availableEngines,
  } = useSmartAnalyze({ legs, eventId, sport });

  const handleClick = async () => {
    const result = await analyze();
    if (result && onAnalysisComplete) {
      onAnalysisComplete(result);
    }
  };

  const RoleIcon = ROLE_CONFIG[userRole].icon;

  const buttonContent = (
    <>
      <AnimatePresence mode="wait">
        {isRunning ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-2"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Analyzing...</span>
          </motion.div>
        ) : results ? (
          <motion.div
            key="complete"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-2"
          >
            <Check className="h-4 w-4" />
            <span>Re-Analyze</span>
          </motion.div>
        ) : (
          <motion.div
            key="default"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="flex items-center gap-2"
          >
            <Zap className="h-4 w-4" />
            <span>Smart Analyze</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  if (variant === 'hero') {
    return (
      <div className={cn("flex flex-col items-center gap-4", className)}>
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            size="lg"
            onClick={handleClick}
            disabled={isRunning}
            className="relative h-14 px-8 text-lg font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/25"
          >
            {buttonContent}
            <Badge 
              variant="secondary" 
              className={cn("absolute -top-2 -right-2 text-xs", ROLE_CONFIG[userRole].color)}
            >
              <RoleIcon className="h-3 w-3 mr-1" />
              {ROLE_CONFIG[userRole].label}
            </Badge>
          </Button>
        </motion.div>
        
        {isRunning && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xs"
          >
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center mt-1">
              {progress}% complete
            </p>
          </motion.div>
        )}
        
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{CONTEXT_LABELS[analyzeContext]}</span>
          <span>•</span>
          <span>{availableEngines.length} engines</span>
        </div>
      </div>
    );
  }

  if (variant === 'sticky') {
    return (
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
          className
        )}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="lg"
                onClick={handleClick}
                disabled={isRunning}
                className="relative shadow-xl shadow-primary/30 bg-gradient-to-r from-primary to-primary/80"
              >
                {buttonContent}
                <Badge 
                  variant="outline" 
                  className="absolute -top-2 -right-2 bg-background text-xs"
                >
                  {availableEngines.length}
                </Badge>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{CONTEXT_LABELS[analyzeContext]}</p>
              <p className="text-xs text-muted-foreground">
                {availableEngines.join(', ')}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>
    );
  }

  if (variant === 'compact') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={isRunning}
        className={cn("gap-1", className)}
      >
        {isRunning ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Zap className="h-3 w-3" />
        )}
        <span className="sr-only sm:not-sr-only">Analyze</span>
      </Button>
    );
  }

  // Default variant
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleClick}
            disabled={isRunning}
            className={cn("relative", className)}
          >
            {buttonContent}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">{CONTEXT_LABELS[analyzeContext]}</p>
            <p className="text-xs text-muted-foreground">
              Running {availableEngines.length} engines as {userRole}
            </p>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground">
                Last run: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
