import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Clock, Zap, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProjectionUpdate } from '@/hooks/useRealtimeProjections';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ProjectionTimelineProps {
  updates: ProjectionUpdate[];
  maxItems?: number;
  showHeader?: boolean;
  className?: string;
}

export const ProjectionTimeline = ({
  updates,
  maxItems = 10,
  showHeader = true,
  className,
}: ProjectionTimelineProps) => {
  const displayUpdates = updates.slice(0, maxItems);

  if (displayUpdates.length === 0) {
    return (
      <Card className={cn("bg-card/50", className)}>
        {showHeader && (
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Live Projections
            </CardTitle>
          </CardHeader>
        )}
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No recent projection updates
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("bg-card/50", className)}>
      {showHeader && (
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Radio className="h-4 w-4 text-green-400" />
            </motion.div>
            Live Projections
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {updates.length} updates
            </Badge>
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="pt-2">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />

          {/* Timeline items */}
          <div className="space-y-3">
            {displayUpdates.map((update, index) => (
              <TimelineItem
                key={update.id}
                update={update}
                isFirst={index === 0}
                isLast={index === displayUpdates.length - 1}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

interface TimelineItemProps {
  update: ProjectionUpdate;
  isFirst: boolean;
  isLast: boolean;
}

const TimelineItem = ({ update, isFirst, isLast }: TimelineItemProps) => {
  const isPositive = update.changePercent > 0;
  const probChange = update.newProbability && update.previousProbability
    ? (update.newProbability - update.previousProbability) * 100
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: isFirst ? 0 : 0.1 }}
      className="relative pl-8"
    >
      {/* Timeline dot */}
      <div className={cn(
        "absolute left-0 w-6 h-6 rounded-full flex items-center justify-center border-2",
        update.isSignificant
          ? isPositive
            ? "bg-green-500/20 border-green-500"
            : "bg-red-500/20 border-red-500"
          : "bg-muted border-border"
      )}>
        {isPositive ? (
          <TrendingUp className="h-3 w-3 text-green-400" />
        ) : (
          <TrendingDown className="h-3 w-3 text-red-400" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        "p-2 rounded-lg border",
        update.isSignificant
          ? isPositive
            ? "bg-green-500/5 border-green-500/20"
            : "bg-red-500/5 border-red-500/20"
          : "bg-muted/20 border-border/50"
      )}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm font-medium truncate">
            {update.playerName}
          </span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {update.propType}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {/* Projection change */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Proj:</span>
            <span className={cn(
              "font-medium",
              isPositive ? "text-green-400" : "text-red-400"
            )}>
              {isPositive ? '+' : ''}{update.changePercent.toFixed(1)}%
            </span>
          </div>

          {/* Probability change */}
          {probChange !== null && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Hit:</span>
              <span className={cn(
                "font-medium",
                probChange > 0 ? "text-green-400" : "text-red-400"
              )}>
                {Math.round(update.previousProbability! * 100)}% → {Math.round(update.newProbability! * 100)}%
              </span>
            </div>
          )}

          {/* Significant badge */}
          {update.isSignificant && (
            <Zap className="h-3 w-3 text-yellow-400" />
          )}
        </div>

        {/* Reason and time */}
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span className="truncate mr-2">{update.changeReason}</span>
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="h-2.5 w-2.5" />
            {formatDistanceToNow(update.createdAt, { addSuffix: true })}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

// Mini chart showing projection trend
interface ProjectionMiniChartProps {
  updates: ProjectionUpdate[];
  className?: string;
}

export const ProjectionMiniChart = ({ updates, className }: ProjectionMiniChartProps) => {
  if (updates.length < 2) return null;

  const sortedUpdates = [...updates].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  const values = sortedUpdates.map(u => u.newProjection);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const trend = values[values.length - 1] > values[0] ? 'up' : 'down';

  return (
    <div className={cn("h-8 w-20", className)}>
      <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={trend === 'up' ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
