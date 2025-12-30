import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ParlayLiveProgress } from '@/hooks/useParlayLiveProgress';
import { LivePlayerPropCard } from './LivePlayerPropCard';

interface LiveParlayCardProps {
  parlay: ParlayLiveProgress;
  defaultExpanded?: boolean;
}

function formatOdds(odds: number): string {
  if (odds >= 2) {
    return `+${Math.round((odds - 1) * 100)}`;
  }
  return `-${Math.round(100 / (odds - 1))}`;
}

export function LiveParlayCard({ parlay, defaultExpanded = false }: LiveParlayCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const getStatusBadge = () => {
    switch (parlay.status) {
      case 'all_hitting':
        return (
          <Badge className="bg-chart-2/20 text-chart-2 border-chart-2/30">
            ALL HITTING
          </Badge>
        );
      case 'mixed':
        return (
          <Badge className="bg-chart-4/20 text-chart-4 border-chart-4/30">
            {parlay.legsHitting}/{parlay.legsTotal} ON PACE
          </Badge>
        );
      case 'busting':
        return (
          <Badge className="bg-destructive/20 text-destructive border-destructive/30">
            BEHIND
          </Badge>
        );
      case 'completed':
        return (
          <Badge className="bg-muted text-muted-foreground border-border">
            COMPLETED
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted text-muted-foreground border-border">
            UPCOMING
          </Badge>
        );
    }
  };

  const getStatusColor = () => {
    switch (parlay.status) {
      case 'all_hitting': return 'border-chart-2/30';
      case 'mixed': return 'border-chart-4/30';
      case 'busting': return 'border-destructive/30';
      default: return 'border-border/50';
    }
  };

  return (
    <Card className={cn(
      'bg-card/50 transition-all duration-200',
      getStatusColor(),
      expanded && 'ring-1 ring-primary/20'
    )}>
      <CardContent 
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {parlay.hasLiveGames && (
              <div className="relative">
                <Zap className="w-5 h-5 text-chart-4" />
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              </div>
            )}
            <div>
              <div className="font-medium text-sm">
                {parlay.legsTotal}-Leg {parlay.sport} Parlay
              </div>
              <div className="text-xs text-muted-foreground">
                {formatOdds(parlay.totalOdds)}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {getStatusBadge()}
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Progress summary when collapsed */}
        {!expanded && parlay.hasLiveGames && (
          <div className="mt-3 flex gap-1">
            {parlay.legs.map((leg, i) => (
              <div
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  leg.gameStatus === 'scheduled' ? 'bg-muted' :
                  leg.isHitting ? 'bg-chart-2' :
                  leg.isOnPace ? 'bg-chart-4' : 'bg-destructive'
                )}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              <div className="h-px bg-border/50 mb-3" />
              {parlay.legs.map((leg, i) => (
                <LivePlayerPropCard key={i} leg={leg} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
