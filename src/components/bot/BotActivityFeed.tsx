/**
 * BotActivityFeed.tsx
 * 
 * Real-time activity feed showing bot events and actions.
 */

import React from 'react';
import { Activity, CheckCircle, Bot, TrendingUp, AlertTriangle, DollarSign, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ActivityEvent {
  id: string;
  created_at: string;
  event_type: string;
  message: string;
  metadata: Record<string, any> | null;
  severity: string | null;
}

const eventIcons: Record<string, React.ReactNode> = {
  parlays_generated: <Bot className="w-4 h-4" />,
  settlement_complete: <DollarSign className="w-4 h-4" />,
  weight_update: <TrendingUp className="w-4 h-4" />,
  activation_check: <CheckCircle className="w-4 h-4" />,
  error: <AlertTriangle className="w-4 h-4" />,
  default: <Activity className="w-4 h-4" />,
};

const severityColors: Record<string, string> = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

function getEventIcon(eventType: string) {
  return eventIcons[eventType] || eventIcons.default;
}

function formatEventTime(createdAt: string) {
  try {
    const date = new Date(createdAt);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function getRelativeTime(createdAt: string) {
  try {
    return formatDistanceToNow(new Date(createdAt), { addSuffix: true });
  } catch {
    return '';
  }
}

export function BotActivityFeed() {
  const { data: events, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['bot-activity-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      return (data as ActivityEvent[]) || [];
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Activity Feed
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={cn(
              "w-4 h-4",
              isRefetching && "animate-spin"
            )} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !events || events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs mt-1">Events will appear here when the bot runs</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 py-2 border-b border-border/30 last:border-0"
                >
                  <div className={cn(
                    "mt-0.5",
                    severityColors[event.severity || 'info']
                  )}>
                    {getEventIcon(event.event_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-tight">{event.message}</p>
                    {event.metadata && Object.keys(event.metadata).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {event.metadata.realLinePicks !== undefined && (
                          <Badge variant="secondary" className="text-xs">
                            📍 {event.metadata.realLinePicks} real lines
                          </Badge>
                        )}
                        {event.metadata.legCounts && (
                          <Badge variant="outline" className="text-xs">
                            {Object.entries(event.metadata.legCounts as Record<string, number>)
                              .map(([legs, count]) => `${legs}L: ${count}`)
                              .join(', ')}
                          </Badge>
                        )}
                        {event.metadata.totalProfitLoss !== undefined && (
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "text-xs",
                              event.metadata.totalProfitLoss >= 0 ? "text-green-400" : "text-red-400"
                            )}
                          >
                            {event.metadata.totalProfitLoss >= 0 ? '+' : ''}
                            ${event.metadata.totalProfitLoss?.toFixed(0)}
                          </Badge>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatEventTime(event.created_at)} • {getRelativeTime(event.created_at)}
                    </p>
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
