import { useState, useEffect } from "react";
import { FeedCard } from "../FeedCard";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Zap, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SharpAlert {
  id: string;
  sport: string;
  description: string;
  bookmaker: string;
  outcome_name: string;
  old_price: number;
  new_price: number;
  price_change: number;
  sharp_indicator: string;
  detected_at: string;
  commence_time?: string;
  determination_status?: 'pending' | 'final';
  clv_direction?: 'positive' | 'negative' | 'neutral';
  movement_authenticity?: string;
  recommendation?: string;
}

interface SharpMoneyAlertsProps {
  delay?: number;
  limit?: number;
}

export function SharpMoneyAlerts({ delay = 0, limit = 5 }: SharpMoneyAlertsProps) {
  const [alerts, setAlerts] = useState<SharpAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAlerts = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('line_movements')
          .select('*')
          .eq('is_sharp_action', true)
          .order('detected_at', { ascending: false })
          .limit(limit);

        if (error) {
          console.error('Error fetching sharp alerts:', error);
          return;
        }

        setAlerts(data || []);
      } catch (err) {
        console.error('Failed to fetch sharp alerts:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAlerts();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('sharp-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'line_movements',
          filter: 'is_sharp_action=eq.true'
        },
        (payload) => {
          setAlerts(prev => [payload.new as SharpAlert, ...prev.slice(0, limit - 1)]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [limit]);

  const formatOdds = (price: number) => {
    return price > 0 ? `+${price}` : `${price}`;
  };

  const getBookmakerName = (key: string) => {
    const names: Record<string, string> = {
      'fanduel': 'FD',
      'draftkings': 'DK',
      'betmgm': 'MGM',
      'caesars': 'CZR'
    };
    return names[key] || key;
  };

  if (isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </FeedCard>
    );
  }

  if (alerts.length === 0) {
    return null; // Don't show if no alerts
  }

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-neon-yellow" />
        <p className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Sharp Money Alerts
        </p>
        <Badge className="bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30 text-xs">
          LIVE
        </Badge>
      </div>

      <div className="space-y-2">
        {alerts.map((alert) => (
          <div 
            key={alert.id}
            className="p-2 rounded-lg bg-neon-yellow/10 border border-neon-yellow/20 relative"
          >
            {/* Pending/Final Status Badge */}
            <div className="absolute top-1 right-1">
              {alert.determination_status === 'pending' ? (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-dashed">
                  ⏳ PENDING
                </Badge>
              ) : (
                <Badge className="text-[9px] px-1 py-0 bg-neon-green/20 text-neon-green border-neon-green/30">
                  ✓ FINAL
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 mt-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-0.5">
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    {alert.sport}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    {getBookmakerName(alert.bookmaker)}
                  </Badge>
                  {alert.clv_direction && alert.determination_status === 'final' && (
                    <Badge 
                      variant={alert.clv_direction === 'positive' ? 'default' : 'destructive'} 
                      className="text-[9px] px-1 py-0"
                    >
                      CLV {alert.clv_direction === 'positive' ? '+' : '-'}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground truncate">
                  {alert.description}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {alert.outcome_name}
                </p>
              </div>
              
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 justify-end">
                  {alert.price_change > 0 ? (
                    <TrendingUp className="w-3 h-3 text-neon-green" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-neon-red" />
                  )}
                  <span className={`text-xs font-bold ${
                    alert.price_change > 0 ? 'text-neon-green' : 'text-neon-red'
                  }`}>
                    {alert.price_change > 0 ? '+' : ''}{alert.price_change}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {formatOdds(alert.old_price)} → {formatOdds(alert.new_price)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mt-1 pt-1 border-t border-neon-yellow/20">
              <p className="text-[10px] text-neon-yellow">
                {alert.sharp_indicator?.split(' - ')[0]}
              </p>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(alert.detected_at), { addSuffix: true })}
              </p>
            </div>

            {/* Show preliminary status message for pending */}
            {alert.determination_status === 'pending' && (
              <p className="text-[9px] text-muted-foreground mt-1 italic">
                Final determination in ~1hr before game
              </p>
            )}
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
