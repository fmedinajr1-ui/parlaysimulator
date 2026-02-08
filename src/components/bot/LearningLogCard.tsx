/**
 * LearningLogCard.tsx
 * 
 * Shows recent weight adjustments and learning events.
 */

import React from 'react';
import { Brain, TrendingUp, TrendingDown, Ban, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { CategoryWeight } from '@/hooks/useBotEngine';

interface LearningLogCardProps {
  weights: CategoryWeight[];
}

export function LearningLogCard({ weights }: LearningLogCardProps) {
  // Generate learning events from current state
  const learningEvents = React.useMemo(() => {
    const events: Array<{
      id: string;
      type: 'boost' | 'penalty' | 'block' | 'streak';
      category: string;
      message: string;
      timestamp: string;
      value?: number;
    }> = [];

    weights.forEach((cat) => {
      // Check for blocked categories
      if (cat.is_blocked) {
        events.push({
          id: `${cat.id}-blocked`,
          type: 'block',
          category: cat.category,
          message: cat.block_reason || 'Weight dropped below threshold',
          timestamp: cat.updated_at || new Date().toISOString(),
        });
      }

      // Check for boosted categories
      if (cat.weight >= 1.2 && !cat.is_blocked) {
        events.push({
          id: `${cat.id}-boost`,
          type: 'boost',
          category: cat.category,
          message: `Weight boosted to ${cat.weight.toFixed(2)}`,
          timestamp: cat.updated_at || new Date().toISOString(),
          value: cat.weight,
        });
      }

      // Check for streaks
      if (Math.abs(cat.current_streak) >= 3) {
        events.push({
          id: `${cat.id}-streak`,
          type: 'streak',
          category: cat.category,
          message: cat.current_streak > 0 
            ? `🔥 ${cat.current_streak} win streak` 
            : `❄️ ${Math.abs(cat.current_streak)} loss streak`,
          timestamp: cat.updated_at || new Date().toISOString(),
          value: cat.current_streak,
        });
      }

      // Check for penalized categories
      if (cat.weight < 0.9 && cat.weight >= 0.5 && !cat.is_blocked) {
        events.push({
          id: `${cat.id}-penalty`,
          type: 'penalty',
          category: cat.category,
          message: `Weight reduced to ${cat.weight.toFixed(2)}`,
          timestamp: cat.updated_at || new Date().toISOString(),
          value: cat.weight,
        });
      }
    });

    // Sort by timestamp descending
    return events.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [weights]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'boost':
        return <TrendingUp className="w-4 h-4 text-green-400" />;
      case 'penalty':
        return <TrendingDown className="w-4 h-4 text-amber-400" />;
      case 'block':
        return <Ban className="w-4 h-4 text-red-400" />;
      case 'streak':
        return <RefreshCw className="w-4 h-4 text-primary" />;
      default:
        return <Brain className="w-4 h-4" />;
    }
  };

  const getEventBadgeStyle = (type: string) => {
    switch (type) {
      case 'boost':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'penalty':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'block':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      default:
        return 'bg-primary/20 text-primary border-primary/50';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Learning Log
          </CardTitle>
          <Badge variant="outline">
            {learningEvents.length} events
          </Badge>
        </div>
        <CardDescription>
          Recent weight adjustments and pattern changes
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {learningEvents.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Brain className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No learning events yet</p>
            <p className="text-sm mt-1">Events will appear after parlays are settled</p>
          </div>
        ) : (
          <ScrollArea className="h-[200px] pr-3">
            <div className="space-y-3">
              {learningEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-2 rounded-lg bg-muted/30"
                >
                  <div className={cn(
                    "p-1.5 rounded-lg shrink-0",
                    event.type === 'boost' && "bg-green-500/20",
                    event.type === 'penalty' && "bg-amber-500/20",
                    event.type === 'block' && "bg-red-500/20",
                    event.type === 'streak' && "bg-primary/20"
                  )}>
                    {getEventIcon(event.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs", getEventBadgeStyle(event.type))}
                      >
                        {event.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{event.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
