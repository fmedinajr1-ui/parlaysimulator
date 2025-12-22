import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, RefreshCw, Activity, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useEngineRealtime, EngineUpdate } from '@/hooks/useEngineRealtime';
import { cn } from '@/lib/utils';

interface EngineStatusBarProps {
  sport?: string;
  engineFilter?: string[];
  showDetails?: boolean;
  className?: string;
}

const ENGINE_COLORS: Record<string, string> = {
  'market-signal-engine': 'bg-blue-500',
  'trap-probability-engine': 'bg-orange-500',
  'median-lock-engine': 'bg-green-500',
  'sharp-engine-v2': 'bg-purple-500',
  'god-mode-upset-engine': 'bg-red-500',
  'coach-tendencies-engine': 'bg-cyan-500',
};

export function EngineStatusBar({
  sport,
  engineFilter,
  showDetails = false,
  className,
}: EngineStatusBarProps) {
  const {
    updates,
    isConnected,
    isLoading,
    lastUpdate,
    getTimeSinceUpdate,
    refresh,
  } = useEngineRealtime({ sport, engineFilter, showToasts: false });

  const [isExpanded, setIsExpanded] = useState(false);
  const [timeSince, setTimeSince] = useState('Never');

  // Update time since every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeSince(getTimeSinceUpdate());
    }, 1000);
    return () => clearInterval(interval);
  }, [getTimeSinceUpdate]);

  // Group updates by engine
  const updatesByEngine = updates.reduce((acc, update) => {
    if (!acc[update.engine_name]) {
      acc[update.engine_name] = [];
    }
    acc[update.engine_name].push(update);
    return acc;
  }, {} as Record<string, EngineUpdate[]>);

  const activeEngines = Object.keys(updatesByEngine).length;

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-3">
            {/* Connection Status */}
            <div className="flex items-center gap-1.5">
              <motion.div
                animate={{
                  scale: isConnected ? [1, 1.2, 1] : 1,
                }}
                transition={{ repeat: isConnected ? Infinity : 0, duration: 2 }}
              >
                {isConnected ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                  <WifiOff className="h-4 w-4 text-red-500" />
                )}
              </motion.div>
              <span className="text-xs text-muted-foreground">
                {isConnected ? 'Live' : 'Offline'}
              </span>
            </div>

            {/* Separator */}
            <div className="h-4 w-px bg-border" />

            {/* Active Engines */}
            <div className="flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs">
                {activeEngines} engine{activeEngines !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Separator */}
            <div className="h-4 w-px bg-border" />

            {/* Last Update */}
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <AnimatePresence mode="wait">
                <motion.span
                  key={timeSince}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="text-xs"
                >
                  {timeSince}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Refresh Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={refresh}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
            </Button>

            {/* Expand Toggle */}
            {showDetails && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        </div>

        {/* Engine Activity Indicators */}
        <div className="flex gap-1 px-3 pb-2">
          {Object.entries(updatesByEngine).map(([engineName, engineUpdates]) => (
            <motion.div
              key={engineName}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn(
                "h-1.5 rounded-full flex-1 max-w-8",
                ENGINE_COLORS[engineName] || 'bg-muted'
              )}
              title={`${engineName}: ${engineUpdates.length} updates`}
            />
          ))}
        </div>

        {showDetails && (
          <CollapsibleContent>
            <div className="border-t px-3 py-2 space-y-2">
              {Object.entries(updatesByEngine).map(([engineName, engineUpdates]) => (
                <div key={engineName} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        ENGINE_COLORS[engineName] || 'bg-muted'
                      )}
                    />
                    <span className="text-sm font-medium">
                      {engineName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {engineUpdates.length}
                  </Badge>
                </div>
              ))}

              {Object.keys(updatesByEngine).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No engine activity yet
                </p>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
