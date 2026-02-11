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

const severityDotColors: Record<string, string> = {
  info: 'bg-blue-400',
  success: 'bg-green-400',
  warning: 'bg-amber-400',
  error: 'bg-red-400',
};

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
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Activity
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
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
          </div>
        ) : (
          <ScrollArea className="h-[280px] pr-2">
            <div className="relative ml-3 border-l border-border/40 pl-4 space-y-3">
              {events.map((event) => (
                <div key={event.id} className="relative">
                  {/* Timeline dot */}
                  <div className={cn(
                    'absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-card',
                    severityDotColors[event.severity || 'info']
                  )} />
                  <p className="text-sm leading-tight">{event.message}</p>
                  {event.metadata && Object.keys(event.metadata).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {event.metadata.totalProfitLoss !== undefined && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs',
                            event.metadata.totalProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'
                          )}
                        >
                          {event.metadata.totalProfitLoss >= 0 ? '+' : ''}${event.metadata.totalProfitLoss?.toFixed(0)}
                        </Badge>
                      )}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {getRelativeTime(event.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
